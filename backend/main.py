import base64
import io
import logging
import os
import time
from typing import Any

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("blind-nav-api")

API_KEY = os.getenv("API_KEY", "dev-secret-key")
MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

INTEREST_CLASSES = {
    "person",
    "car",
    "motorcycle",
    "bicycle",
    "chair",
    "dining table",
    "bench",  # fallback for table-like obstacle
    "traffic light",  # fallback for pole-like obstacle
    "stop sign",  # fallback for pole/sign obstacle
    "door",
    "stairs",
    "wall",
    "table",
    "pole",
}

CANONICAL_NAMES = {
    "dining table": "table",
    "bench": "table",
    "traffic light": "pole",
    "stop sign": "pole",
}


class FramePayload(BaseModel):
    image_base64: str
    include_depth_estimate: bool = False


app = FastAPI(title="Blind Navigation YOLO API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: YOLO | None = None


def decode_base64_image(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:  # broad for malformed images
        raise HTTPException(status_code=400, detail="Invalid image payload") from exc

    return np.array(image)


def estimate_proximity(box_area: float, image_area: float) -> str:
    ratio = box_area / max(image_area, 1)
    if ratio > 0.2:
        return "very_close"
    if ratio > 0.1:
        return "near"
    return "far"


def estimate_direction(center_x: float, width: int) -> str:
    normalized = center_x / max(width, 1)
    if normalized < 0.33:
        return "left"
    if normalized > 0.66:
        return "right"
    return "center"


def build_instruction(direction: str, proximity: str, obj_name: str) -> str:
    if direction == "center" and proximity == "very_close":
        return f"Stop immediately. {obj_name.title()} directly ahead."
    if direction == "left":
        return f"Move slightly right. {obj_name.title()} detected on left."
    if direction == "right":
        return f"Move slightly left. {obj_name.title()} detected on right."
    return f"Proceed carefully. {obj_name.title()} ahead."


def depth_from_area(box_area: float, image_area: float) -> dict[str, Any]:
    ratio = box_area / max(image_area, 1)
    # Naive monocular heuristic for demo use.
    meters = round(max(0.4, min(6.0, 2.8 - ratio * 8)), 2)
    return {"estimated_distance_m": meters, "method": "box-area-heuristic"}


@app.on_event("startup")
def startup() -> None:
    global model
    logger.info("Loading model %s", MODEL_NAME)
    model = YOLO(MODEL_NAME)
    dummy = np.zeros((320, 320, 3), dtype=np.uint8)
    _ = model.predict(dummy, imgsz=320, verbose=False)
    logger.info("Model warm start complete")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/detect")
def detect(payload: FramePayload, x_api_key: str = Header(default="")) -> dict[str, Any]:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    frame = decode_base64_image(payload.image_base64)
    h, w, _ = frame.shape
    image_area = float(h * w)

    start = time.perf_counter()
    results = model.predict(frame, imgsz=320, conf=0.35, verbose=False)
    inference_ms = (time.perf_counter() - start) * 1000

    detections: list[dict[str, Any]] = []
    for result in results:
        names = result.names
        for box in result.boxes:
            cls = int(box.cls[0])
            label = names.get(cls, str(cls))
            if label not in INTEREST_CLASSES:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            box_w = max(0.0, x2 - x1)
            box_h = max(0.0, y2 - y1)
            box_area = box_w * box_h
            center_x = x1 + box_w / 2

            canonical = CANONICAL_NAMES.get(label, label)
            proximity = estimate_proximity(box_area, image_area)
            direction = estimate_direction(center_x, w)
            instruction = build_instruction(direction, proximity, canonical)

            det: dict[str, Any] = {
                "object": canonical,
                "direction": direction,
                "proximity": proximity,
                "instruction": instruction,
                "confidence": round(float(box.conf[0]), 3),
            }
            if payload.include_depth_estimate:
                det["depth"] = depth_from_area(box_area, image_area)
            detections.append(det)

    detections.sort(
        key=lambda d: (
            {"very_close": 0, "near": 1, "far": 2}.get(d["proximity"], 3),
            -d["confidence"],
        )
    )

    logger.info("Inference %.2f ms, detections=%d", inference_ms, len(detections))

    if not detections:
        return {
            "object": None,
            "direction": "center",
            "proximity": "far",
            "instruction": "Path is clear.",
            "inference_ms": round(inference_ms, 2),
            "history": [],
        }

    primary = detections[0]
    return {
        **primary,
        "inference_ms": round(inference_ms, 2),
        "history": detections[:5],
    }
