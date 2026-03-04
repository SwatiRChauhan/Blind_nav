import { useEffect, useMemo, useRef, useState } from 'react'
import { firebaseEnabled, saveEmergencyEvent } from './firebase'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000/detect'
const API_KEY = import.meta.env.VITE_API_KEY || 'dev-secret-key'

const voices = [
  { code: 'en-US', label: 'English' },
  { code: 'hi-IN', label: 'Hindi' },
]

const proximityRank = { very_close: 0, near: 1, far: 2 }

function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [status, setStatus] = useState('Stopped')
  const [instruction, setInstruction] = useState('Tap Start to begin navigation')
  const [darkMode, setDarkMode] = useState(true)
  const [language, setLanguage] = useState('en-US')
  const [includeDepth, setIncludeDepth] = useState(false)
  const [history, setHistory] = useState([])
  const [lastResponseMs, setLastResponseMs] = useState(null)
  const [running, setRunning] = useState(false)

  const className = useMemo(() => (darkMode ? 'app dark' : 'app light'), [darkMode])

  useEffect(() => {
    document.body.className = darkMode ? 'theme-dark' : 'theme-light'
  }, [darkMode])

  useEffect(() => {
    let interval
    let stream

    async function start() {
      if (!running) return
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setStatus('Running')
        interval = setInterval(captureAndDetect, 400)
      } catch (error) {
        setStatus('Camera blocked')
        setInstruction('Please allow camera permission')
      }
    }

    start()
    return () => {
      if (interval) clearInterval(interval)
      if (stream) stream.getTracks().forEach((track) => track.stop())
      setStatus('Stopped')
    }
  }, [running])

  function speak(text) {
    if (!('speechSynthesis' in window)) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language
    utterance.rate = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  function vibrateCritical(message) {
    const isCritical = /stop immediately/i.test(message)
    if (isCritical && navigator.vibrate) navigator.vibrate([200, 100, 200])
  }

  async function captureAndDetect() {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    canvas.width = 320
    canvas.height = 320
    ctx.drawImage(videoRef.current, 0, 0, 320, 320)
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.6)

    const started = performance.now()
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          image_base64: imageBase64,
          include_depth_estimate: includeDepth,
        }),
      })
      if (!res.ok) throw new Error('Detection API failed')

      const data = await res.json()
      setInstruction(data.instruction)
      setLastResponseMs(Math.round(performance.now() - started))
      setHistory((prev) => [
        {
          ts: new Date().toLocaleTimeString(),
          object: data.object || 'none',
          direction: data.direction,
          proximity: data.proximity,
          instruction: data.instruction,
          depth: data.depth?.estimated_distance_m,
        },
        ...prev,
      ].slice(0, 12))

      speak(data.instruction)
      vibrateCritical(data.instruction)
    } catch (error) {
      setInstruction('Detection unavailable. Check server connection.')
    }
  }

  async function triggerEmergencyAlert() {
    const message = `Emergency ping from Vision Companion at ${new Date().toISOString()}`
    const sent = await saveEmergencyEvent(message).catch(() => false)
    if (sent) {
      setInstruction('Emergency alert sent to Firebase contacts.')
      speak('Emergency alert sent')
    } else {
      setInstruction('Firebase not configured. Add Firebase env vars to enable alerts.')
    }
  }

  const latestRisk = history.slice(0, 5).sort((a, b) => (proximityRank[a.proximity] ?? 9) - (proximityRank[b.proximity] ?? 9))[0]

  return (
    <div className={className}>
      <h1>Vision Companion</h1>
      <p className="sub">Audio-first blind navigation assistant</p>

      <div className="statusRing">
        <p>{status.toUpperCase()}</p>
        <strong>{instruction}</strong>
      </div>

      <div className="controls">
        <button onClick={() => setRunning((v) => !v)}>{running ? 'Stop' : 'Start'} Navigation</button>
        <button onClick={() => setDarkMode((v) => !v)}>Toggle {darkMode ? 'Light' : 'Dark'} Mode</button>
        <button onClick={triggerEmergencyAlert}>Emergency Contact</button>
      </div>

      <div className="toggles">
        <label>
          Voice Language
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {voices.map((voice) => (
              <option key={voice.code} value={voice.code}>{voice.label}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={includeDepth} onChange={(e) => setIncludeDepth(e.target.checked)} />
          Enable depth estimation
        </label>
      </div>

      <div className="stats">
        <div><span>Latency</span><b>{lastResponseMs ? `${lastResponseMs} ms` : '--'}</b></div>
        <div><span>Firebase</span><b>{firebaseEnabled() ? 'Enabled' : 'Disabled'}</b></div>
        <div><span>Highest risk</span><b>{latestRisk ? `${latestRisk.object} (${latestRisk.proximity})` : 'none'}</b></div>
      </div>

      <video ref={videoRef} className="video" playsInline muted />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <section>
        <h2>Obstacle History</h2>
        <ul>
          {history.map((item, idx) => (
            <li key={`${item.ts}-${idx}`}>
              [{item.ts}] {item.instruction}
              {item.depth ? ` (~${item.depth}m)` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
