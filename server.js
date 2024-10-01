const WebSocket = require('ws');
const http = require('http');

// Create an HTTP server
const server = http.createServer();

// Use the WebSocket server with the HTTP server
const wss = new WebSocket.Server({ server });

let waitingQueue = [];
let connectedPairs = new Map();

function pairUsers() {
    console.log('Attempting to pair users. Queue length:', waitingQueue.length);
    while (waitingQueue.length >= 2) {
        const user1 = waitingQueue.shift();
        const user2 = waitingQueue.shift();

        // Check if both users are still connected
        if (user1.readyState !== WebSocket.OPEN) {
            console.log('User1 disconnected before pairing');
            if (user2.readyState === WebSocket.OPEN) waitingQueue.unshift(user2);
            continue;
        }

        if (user2.readyState !== WebSocket.OPEN) {
            console.log('User2 disconnected before pairing');
            if (user1.readyState === WebSocket.OPEN) waitingQueue.unshift(user1);
            continue;
        }

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
    }
    console.log('Pairing complete. Remaining in queue:', waitingQueue.length);
}

function removeFromQueue(ws) {
    const index = waitingQueue.indexOf(ws);
    if (index > -1) {
        waitingQueue.splice(index, 1);
    }
}

function sendMessage(user, message) {
    if (user.readyState === WebSocket.OPEN) {
        user.send(JSON.stringify(message));
    }
}

function handleReady(ws) {
    if (!waitingQueue.includes(ws)) {
        waitingQueue.push(ws);
        sendMessage(ws, { type: 'waiting' });
        pairUsers();
    } else {
        console.log('Client is already in the waiting queue');
    }
}

function handleNext(ws) {
    console.log('Handling next for a user');
    const partner = connectedPairs.get(ws);
    if (partner) {
        sendMessage(partner, { type: 'partnerDisconnected' });
        connectedPairs.delete(ws);
        connectedPairs.delete(partner);
        delete ws.partner;
        delete partner.partner;

        if (partner.readyState === WebSocket.OPEN) {
            waitingQueue.push(partner);
            sendMessage(partner, { type: 'waiting' });
        }
    }
    if (ws.readyState === WebSocket.OPEN) {
        waitingQueue.push(ws);
        sendMessage(ws, { type: 'waiting' });
    }
    pairUsers();
}

function handleDisconnect(ws) {
    console.log('Handling disconnect for a user');
    const partner = connectedPairs.get(ws);
    if (partner) {
        sendMessage(partner, { type: 'partnerDisconnected' });
        connectedPairs.delete(ws);
        connectedPairs.delete(partner);
        delete ws.partner;
        delete partner.partner;

        if (partner.readyState === WebSocket.OPEN) {
            waitingQueue.push(partner);
            sendMessage(partner, { type: 'waiting' });
            pairUsers();
        }
    } else {
        removeFromQueue(ws);
    }
}

function sendError(ws, message) {
    sendMessage(ws, { type: 'error', message: message });
}

// Use this in error cases, e.g.:
// sendError(ws, 'Failed to pair with a partner');

wss.on('connection', (ws) => {
    console.log('New user connected. Total connections:', wss.clients.size);
    console.log('New user connected');

    ws.isAlive = true;
    ws.on('pong', () => {

        ws.isAlive = true;
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
    
            if (data.type === 'ping') {
                sendMessage(ws, { type: 'pong' });
                ws.isAlive = true; // Update the connection's liveness
                return; // Skip further processing
            }

            switch (data.type) {
                case 'ready':
                    handleReady(ws);
                    break;
                case 'next':
                    handleNext(ws);
                    break;
                case 'disconnected':
                    handleDisconnect(ws);
                    break;
                case 'offer':
                case 'answer':
                case 'candidate':
                case 'blurState':
                    if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
                        sendMessage(ws.partner, data);
                        } else {
                            console.log('No partner to send message to');
                        }
                        break;
                    default:
                     console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`User disconnected. Code: ${code}, Reason: ${reason}. Remaining connections: ${wss.clients.size}`);
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Heartbeat mechanism to check client connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});