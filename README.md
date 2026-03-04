# AI-Based Real-Time Blind Navigation System (Web + Cloud YOLO)

Production-ready mobile web application for blind navigation assistance using a cloud-hosted YOLOv8n detector.

## Architecture

- **Frontend (React + Vite + PWA):**
  - Mobile browser camera access with `getUserMedia`.
  - Captures a frame every 400ms, resizes to `320x320`, sends base64 to backend.
  - Receives object/direction/proximity instruction JSON.
  - Speaks guidance with Web Speech API.
  - Triggers vibration on critical stop alerts.
  - Includes high-contrast UI, dark mode toggle, language toggle, history panel.
  - Optional Firebase emergency alert support.
  - Optional depth estimation toggle (heuristic from bounding box area).

- **Backend (FastAPI + YOLOv8n):**
  - Loads YOLO model once at startup and runs warm inference.
  - API key protected `/detect` endpoint.
  - Decodes base64 image safely and handles invalid payloads.
  - Runs YOLO detection and filters important classes.
  - Computes direction, proximity, and instruction message.
  - Logs inference latency for observability.

## Folder Structure

```text
backend/
  main.py
  requirements.txt
  render.yaml
frontend/
  public/
    manifest.webmanifest
    sw.js
  src/
    App.jsx
    firebase.js
    main.jsx
    styles.css
  index.html
  package.json
  vite.config.js
```

## Backend Setup (Local)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export API_KEY="your-secure-key"
uvicorn main:app --host 0.0.0.0 --port 10000 --reload
```

Health check:

```bash
curl http://localhost:10000/health
```

## Frontend Setup (Local)

```bash
cd frontend
npm install
cp .env.example .env
npm run dev -- --host
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:10000/detect
VITE_API_KEY=your-secure-key
# Optional Firebase
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## API Contract

`POST /detect`

Request:

```json
{
  "image_base64": "data:image/jpeg;base64,...",
  "include_depth_estimate": false
}
```

Example response:

```json
{
  "object": "chair",
  "direction": "left",
  "proximity": "near",
  "instruction": "Move slightly right. Chair detected on left.",
  "confidence": 0.92,
  "inference_ms": 182.4,
  "history": []
}
```

## Render Deployment (Backend)

1. Push repository to GitHub.
2. In Render, create a **Blueprint** service and point to repo.
3. Render auto-reads `backend/render.yaml`.
4. Set env vars if needed:
   - `API_KEY`
   - `ALLOWED_ORIGINS`
   - `YOLO_MODEL` (`yolov8n.pt`)
5. Deploy and verify `/health`.

Start command used:

```bash
uvicorn main:app --host 0.0.0.0 --port 10000
```

## Vercel Deployment (Frontend)

1. Import project into Vercel.
2. Set **Root Directory** to `frontend`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variables:
   - `VITE_API_URL=https://<your-render-app>/detect`
   - `VITE_API_KEY=<same-api-key-as-backend>`
   - Optional Firebase env vars
6. Deploy.

## Testing on Mobile Browser

1. Open deployed frontend URL on phone.
2. Allow camera permission.
3. Tap **Start Navigation**.
4. Walk in controlled safe environment with obstacles.
5. Confirm spoken instructions and vibration on critical stop alerts.
6. Toggle depth estimation and language.
7. Test emergency button with Firebase configured.

## Processing Logic Implemented

- Important classes: person, car, motorcycle, bicycle, chair, table, pole, stairs, wall, door (with fallback mapping for COCO labels).
- Proximity by area ratio:
  - `>20%` => `very_close`
  - `>10%` => `near`
  - else `far`
- Direction by x center:
  - `<33%` => `left`
  - `>66%` => `right`
  - else `center`
- Instruction policy:
  - center + very_close => **Stop immediately**
  - left => **Move slightly right**
  - right => **Move slightly left**
  - no obstacle => **Path is clear**

## Performance Notes

- YOLOv8n chosen for low-latency inference.
- Input constrained to 320x320 frames.
- Frontend sampling at 400ms.
- API key auth and strict payload validation included.

## Future Improvements

- Integrate true monocular depth model (MiDaS / ZoeDepth).
- Use object tracking across frames for stable guidance.
- Add multilingual TTS voice selection per locale device voices.
- Add offline failover guidance rules when network drops.
- Integrate emergency SMS/voice call automation.
- Add analytics dashboard for navigation risk trends.

## UI Interface Notes

- High contrast circular guidance indicator.
- One-tap Start/Stop workflow.
- Dark/light mode support.
- Live risk, latency, Firebase status cards.
- Rolling obstacle history list.

