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

// Helpers
function toWorld(x: number, y: number): Point {
  return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
}

// Random color generator
function getRandomColor() {
  return `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
}

// WebSocket setup
const ws = new WebSocket("ws://localhost:8080"); // Change to your server URL
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
      // Optionally, you could trigger a redraw here if needed
    }
    if (data.type === "history" && Array.isArray(data.strokes)) {
      strokes.length = 0; // Clear any existing strokes
      strokes.push(...data.strokes);
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
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 1 && e.button === 0) {
    // Start stroke
    const pos = toWorld(e.clientX, e.clientY);
    const color = getRandomColor();
    currentStroke = { points: [pos], color, width: 2 };
    // Do not push to strokes yet; wait for server broadcast
  }
});

canvas.addEventListener("pointermove", (e: PointerEvent) => {
  if (!activePointers.has(e.pointerId)) return;
  const prev = activePointers.get(e.pointerId)!;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 1 && currentStroke) {
    // Continue stroke
    currentStroke.points.push(toWorld(e.clientX, e.clientY));
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
    // Send stroke to server
    ws.send(JSON.stringify({ type: "stroke", stroke: currentStroke }));
  }
  currentStroke = null;
  lastPan = null;
});

canvas.addEventListener("pointercancel", (e: PointerEvent) => {
  activePointers.delete(e.pointerId);
});

// Wheel zoom (desktop)
canvas.addEventListener("wheel", (e: WheelEvent) => {
  const zoomIntensity = 0.1;
  const mouse = toWorld(e.clientX, e.clientY);
  const delta = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;

  scale *= delta;
  offsetX = e.clientX - mouse.x * scale;
  offsetY = e.clientY - mouse.y * scale;
});

// Draw loop
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  // Grid
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1 / scale;
  for (let x = -5000; x < 5000; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, -5000);
    ctx.lineTo(x, 5000);
    ctx.stroke();
  }
  for (let y = -5000; y < 5000; y += 50) {
    ctx.beginPath();
    ctx.moveTo(-5000, y);
    ctx.lineTo(5000, y);
    ctx.stroke();
  }

  // Strokes from server
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width; // Preserve thickness when zooming
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  // Optimistically show current stroke
  if (currentStroke) {
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.width; // Preserve thickness when zooming
    ctx.beginPath();
    currentStroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  requestAnimationFrame(draw);
}
draw();
