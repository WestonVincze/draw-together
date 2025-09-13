const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// Types
type Point = { x: number; y: number };
type Stroke = {
  points: Point[];
  color: string;
  width: number;
};

// Resize canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Viewport state
let scale = 1;
let offsetX = 0;
let offsetY = 0;

// Drawing state
const strokes: Stroke[] = [];
let currentStroke: Stroke | null = null;

// Track in-progress strokes from other users
const remoteStrokes = new Map<string, Stroke>();
let updateInterval: number | null = null;
let clientId = Math.random().toString(36).slice(2); // Simple client ID

// Helpers
function toWorld(x: number, y: number): Point {
  return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
}

// Random color generator
function getRandomColor() {
  return `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
}

// WebSocket setup
const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:8080";
const ws = new WebSocket(wsUrl);
ws.addEventListener("open", () => {
  console.log("WebSocket connected");
});

// Receive strokes from other users
ws.addEventListener("message", async (event) => {
  let text: string;
  if (event.data instanceof Blob) {
    text = await event.data.text();
  } else {
    text = event.data;
  }
  try {
    const data = JSON.parse(text);
    if (data.type === "stroke" && data.stroke) {
      strokes.push(data.stroke);
      // Remove remote in-progress stroke
      if (data.clientId) remoteStrokes.delete(data.clientId);
    }
    if (data.type === "stroke-update" && data.stroke && data.clientId && data.clientId !== clientId) {
      remoteStrokes.set(data.clientId, data.stroke);
    }
    if (data.type === "history" && Array.isArray(data.strokes)) {
      strokes.length = 0; // Clear any existing strokes
      strokes.push(...data.strokes);
      remoteStrokes.clear();
    }
  } catch (e) {
    console.error("WebSocket message error", e, event.data);
  }
});

// Pointer state
const activePointers = new Map<number, Point>();
let lastPan: Point | null = null;

// Pointer events
canvas.addEventListener("pointerdown", (e: PointerEvent) => {
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  activePointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

  if (activePointers.size === 1 && e.button === 0) {
    // Start stroke
    const pos = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const color = getRandomColor();
    currentStroke = { points: [pos], color, width: 3 };
    // Start sending partial updates every 250ms
    updateInterval = window.setInterval(() => {
      if (currentStroke) {
        ws.send(
          JSON.stringify({
            type: "stroke-update",
            stroke: currentStroke,
            clientId,
          })
        );
      }
    }, 250);
  }
});

canvas.addEventListener("pointermove", (e: PointerEvent) => {
  if (!activePointers.has(e.pointerId)) return;
  const rect = canvas.getBoundingClientRect();
  const prev = activePointers.get(e.pointerId)!;
  activePointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

  if (activePointers.size === 1 && currentStroke) {
    // Continue stroke
    currentStroke.points.push(toWorld(e.clientX - rect.left, e.clientY - rect.top));
  } else if (activePointers.size === 2) {
    // Pinch/zoom gesture
    const pts = Array.from(activePointers.values());
    const [p1, p2] = pts;

    const prevPts = Array.from(activePointers.entries()).map(([id, val]) =>
      id === e.pointerId ? prev : val
    );
    const [pp1, pp2] = prevPts;

    const prevDist = Math.hypot(pp2.x - pp1.x, pp2.y - pp1.y);
    const currDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    const zoom = currDist / prevDist;
    const centerScreen: Point = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
    const centerWorld = toWorld(centerScreen.x, centerScreen.y);

    scale *= zoom;
    offsetX = centerScreen.x - centerWorld.x * scale;
    offsetY = centerScreen.y - centerWorld.y * scale;

    if (lastPan) {
      offsetX += centerScreen.x - lastPan.x;
      offsetY += centerScreen.y - lastPan.y;
    }
    lastPan = centerScreen;
  }
});

canvas.addEventListener("pointerup", (e: PointerEvent) => {
  canvas.releasePointerCapture(e.pointerId);
  activePointers.delete(e.pointerId);
  if (currentStroke) {
    // Send final stroke to server
    ws.send(JSON.stringify({ type: "stroke", stroke: currentStroke, clientId }));
  }
  currentStroke = null;
  lastPan = null;
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
});

canvas.addEventListener("pointercancel", (e: PointerEvent) => {
  activePointers.delete(e.pointerId);
});

// Wheel zoom (desktop)
canvas.addEventListener("wheel", (e: WheelEvent) => {
  const rect = canvas.getBoundingClientRect();
  const zoomIntensity = 0.1;
  const mouse = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const delta = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;

  scale *= delta;
  offsetX = e.clientX - rect.left - mouse.x * scale;
  offsetY = e.clientY - rect.top - mouse.y * scale;
});

// Brush switching
let currentBrush = 1;
window.addEventListener('keydown', (e) => {
  if (e.key === '1') currentBrush = 1;
  if (e.key === '2') currentBrush = 2;
});

// Draw stroke with brush effect
function drawStroke(stroke: Stroke, alpha = 0.85) {
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;
  if (currentBrush === 1) {
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  } else if (currentBrush === 2) {
    // Realistic brush: simulate bristles
    const bristleCount = 8;
    const spread = stroke.width * 0.6;
    for (let b = 0; b < bristleCount; b++) {
      const angle = (2 * Math.PI * b) / bristleCount;
      const dx = Math.cos(angle) * spread;
      const dy = Math.sin(angle) * spread;
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const px = p.x + dx * Math.random();
        const py = p.y + dy * Math.random();
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1.0;
}

// Add fullscreen button
const fullscreenBtn = document.createElement('button');
fullscreenBtn.textContent = '⛶';
fullscreenBtn.id = 'fullscreen-btn';
fullscreenBtn.title = 'Fullscreen';
fullscreenBtn.style.position = 'absolute';
fullscreenBtn.style.top = '16px';
fullscreenBtn.style.right = '16px';
fullscreenBtn.style.zIndex = '1000';
fullscreenBtn.style.padding = '8px 12px';
fullscreenBtn.style.fontSize = '20px';
fullscreenBtn.style.borderRadius = '6px';
fullscreenBtn.style.border = 'none';
fullscreenBtn.style.background = 'rgba(255,255,255,0.8)';
fullscreenBtn.style.cursor = 'pointer';
fullscreenBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
fullscreenBtn.style.transition = 'background 0.2s';
fullscreenBtn.onmouseenter = () => fullscreenBtn.style.background = 'rgba(255,255,255,1)';
fullscreenBtn.onmouseleave = () => fullscreenBtn.style.background = 'rgba(255,255,255,0.8)';
document.body.appendChild(fullscreenBtn);

fullscreenBtn.onclick = () => {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

// Draw loop
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  // Hide fullscreen button while drawing
  if (fullscreenBtn) {
    fullscreenBtn.style.display = currentStroke ? 'none' : 'block';
  }

  // Strokes from server
  for (const stroke of strokes) {
    drawStroke(stroke);
  }

  // Optimistically show current stroke
  if (currentStroke) {
    drawStroke(currentStroke);
  }

  // Show in-progress remote strokes
  for (const stroke of remoteStrokes.values()) {
    drawStroke(stroke, 0.5);
  }

  requestAnimationFrame(draw);
}

draw();

