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
        ws.send(JSON.stringify({ type: 'connected', isOfferer: true }));  // ws is the offerer
        otherClient.send(JSON.stringify({ type: 'connected', isOfferer: false }));  // otherClient is the answerer

        // Forward messages between clients
        ws.on('message', (message) => {
            console.log('Forwarding message between clients...');
            otherClient.send(message);
        });

        otherClient.on('message', (message) => {
            console.log('Forwarding message between clients...');
            ws.send(message);
        });

        ws.on('close', () => {
            console.log('User disconnected.');
            if (otherClient) {
                otherClient.send(JSON.stringify({ type: 'disconnected' }));
                otherClient.close(); // Close the other client's connection
            }
        });

        otherClient.on('close', () => {
            console.log('Other user disconnected.');
            if (ws) {
                ws.send(JSON.stringify({ type: 'disconnected' }));
                ws.close(); // Close this client's connection
            }
        });

    } else {
        console.log('Waiting for another user to connect...');
        waitingClient = ws;

        ws.send(JSON.stringify({ type: 'waiting' }));

        ws.on('close', () => {
            console.log('Waiting client disconnected.');
            waitingClient = null; // Reset waiting client when they disconnect
        });
    }
});

// Start the server and listen on port 443
const PORT = process.env.PORT || 443;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});