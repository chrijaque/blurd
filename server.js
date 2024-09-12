const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

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

console.log('WebSocket server is running...');