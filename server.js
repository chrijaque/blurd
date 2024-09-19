const WebSocket = require('ws');
const http = require('http');

// Create an HTTP server
const server = http.createServer();

// Use the WebSocket server with the HTTP server
const wss = new WebSocket.Server({ server });

let waitingQueue = [];
let connectedPairs = new Map();

function pairUsers() {
    while (waitingQueue.length >= 2) {
        const user1 = waitingQueue.shift();
        const user2 = waitingQueue.shift();

        // Randomly decide who is the offerer
        const isUser1Offerer = Math.random() < 0.5;

        // Assign roles
        sendMessage(user1, { type: 'paired', isOfferer: isUser1Offerer });
        sendMessage(user2, { type: 'paired', isOfferer: !isUser1Offerer });

        connectedPairs.set(user1, user2);
        connectedPairs.set(user2, user1);

        user1.partner = user2;
        user2.partner = user1;

        console.log('Paired two users');

        if (user1.readyState !== WebSocket.OPEN || user2.readyState !== WebSocket.OPEN) {
            console.log('One of the users disconnected before pairing');
            if (user1.readyState === WebSocket.OPEN) waitingQueue.unshift(user1);
            if (user2.readyState === WebSocket.OPEN) waitingQueue.unshift(user2);
        }
    }
    console.log('Pairing complete. Remaining in queue:', waitingQueue.length);
}

function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    console.log('New user connected');

    ws.isAlive = true;
    ws.on('pong', heartbeat);

    ws.on('message', (message) => {
        // ... existing message handling code ...
    });

    ws.on('close', (code, reason) => {
        console.log(`User disconnected. Code: ${code}, Reason: ${reason}`);
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Heartbeat mechanism to keep connections alive
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection');
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 5000); // Ping every 5 seconds

wss.on('close', () => {
    clearInterval(interval);
});