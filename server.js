const http = require('http');
const WebSocket = require('ws');

// Create an HTTP server
const server = http.createServer();

// Use the WebSocket server with the HTTP server
const wss = new WebSocket.Server({ server });

let waitingClient = null;

wss.on('connection', (ws) => {
    console.log('A user connected.');

    if (waitingClient) {
        console.log('Pairing with the waiting client.');
        const otherClient = waitingClient;
        waitingClient = null;

        ws.send(JSON.stringify({ type: 'connected', isOfferer: true }));
        otherClient.send(JSON.stringify({ type: 'connected', isOfferer: false }));

        ws.on('message', (message) => {
            otherClient.send(message);
        });

        otherClient.on('message', (message) => {
            ws.send(message);
        });

        ws.on('close', () => {
            otherClient.close();
        });

        otherClient.on('close', () => {
            ws.close();
        });
    } else {
        console.log('Waiting for another user to connect...');
        waitingClient = ws;

        ws.send(JSON.stringify({ type: 'waiting' }));

        ws.on('close', () => {
            waitingClient = null;
        });
    }
});

// Start server on port 443 (HTTPS)
const PORT = 443;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});