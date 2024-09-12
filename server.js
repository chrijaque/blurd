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

        // Let both clients know they are connected
        ws.send(JSON.stringify({ type: 'connected' }));
        otherClient.send(JSON.stringify({ type: 'connected' }));

        // Forward messages between clients
        ws.on('message', (message) => {
            otherClient.send(message);
        });

        otherClient.on('message', (message) => {
            ws.send(message);
        });

        ws.on('close', () => {
            console.log('User disconnected.');
            otherClient.close();
        });

        otherClient.on('close', () => {
            console.log('Other user disconnected.');
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

// Start the server and listen on the provided PORT environment variable
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});