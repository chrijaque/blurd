const http = require('http');
const WebSocket = require('ws');

// Create an HTTP server
const server = http.createServer();

// Use the WebSocket server with the HTTP server
const wss = new WebSocket.Server({ server });

let waitingClient = null;

wss.on('connection', (ws) => {
    console.log('A user connected.');

    // Check if there is a waiting client
    if (waitingClient) {
        console.log('Pairing with the waiting client.');

        const otherClient = waitingClient;
        waitingClient = null;

        // Notify both clients that they are paired
        ws.send(JSON.stringify({ type: 'connected', isOfferer: true }));
        otherClient.send(JSON.stringify({ type: 'connected', isOfferer: false }));

        // Forward messages between the two clients
        ws.on('message', (message) => {
            otherClient.send(message);
        });

        otherClient.on('message', (message) => {
            ws.send(message);
        });

        ws.on('close', () => {
            console.log('A user disconnected.');
            otherClient.close();
        });

        otherClient.on('close', () => {
            console.log('The other user disconnected.');
            ws.close();
        });

    } else {
        console.log('Waiting for another user to connect...');
        waitingClient = ws;

        ws.send(JSON.stringify({ type: 'waiting' }));

        ws.on('close', () => {
            console.log('Waiting client disconnected.');
            waitingClient = null;
        });
    }
});

// Start the server
const PORT = process.env.PORT || 443;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});