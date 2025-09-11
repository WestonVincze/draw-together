import { WebSocketServer, WebSocket } from 'ws';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

const strokes: any[] = [];

wss.on('connection', (ws: WebSocket) => {
  // Send all previous strokes to the new client
  ws.send(JSON.stringify({ type: 'history', strokes }));

  ws.on('message', (message: string | Buffer) => {
    let data: any;
    try {
      if (typeof message !== 'string') {
        message = message.toString();
      }
      data = JSON.parse(message);
    } catch (e) {
      return;
    }
    if (data.type === 'stroke' && data.stroke) {
      strokes.push(data.stroke);
      // Broadcast to all clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'stroke', stroke: data.stroke }));
        }
      });
    }
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
