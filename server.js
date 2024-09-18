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

        if (user1.readyState === WebSocket.OPEN && user2.readyState === WebSocket.OPEN) {
            user1.partner = user2;
            user2.partner = user1;

            connectedPairs.set(user1, user2);
            connectedPairs.set(user2, user1);

            // Randomly decide who is the offerer
            const isUser1Offerer = Math.random() < 0.5;

            sendMessage(user1, { type: 'paired', isOfferer: isUser1Offerer });
            sendMessage(user2, { type: 'paired', isOfferer: !isUser1Offerer });
            console.log('Paired two users');
        } else {
            console.log('One of the users disconnected before pairing');
            if (user1.readyState === WebSocket.OPEN) waitingQueue.unshift(user1);
            if (user2.readyState === WebSocket.OPEN) waitingQueue.unshift(user2);
        }
    }
    console.log('Pairing complete. Remaining in queue:', waitingQueue.length);
}

function handleNext(user) {
    console.log('Handling next for a user');
    const partner = connectedPairs.get(user);
    if (partner) {
        sendMessage(partner, { type: 'partnerDisconnected' });
        connectedPairs.delete(user);
        connectedPairs.delete(partner);
        delete user.partner;
        delete partner.partner;

        if (partner.readyState === WebSocket.OPEN) {
            waitingQueue.push(partner);
            sendMessage(partner, { type: 'waiting' });
        }
    }
    if (user.readyState === WebSocket.OPEN) {
        waitingQueue.push(user);
        sendMessage(user, { type: 'waiting' });
    }
    pairUsers();
}

function handleDisconnect(user) {
    console.log('Handling disconnect for a user');
    const partner = connectedPairs.get(user);
    if (partner) {
        sendMessage(partner, { type: 'partnerDisconnected' });
        connectedPairs.delete(user);
        connectedPairs.delete(partner);
        // Give the disconnected user some time to potentially reconnect
        setTimeout(() => {
            if (partner.readyState === WebSocket.OPEN && !connectedPairs.has(partner)) {
                waitingQueue.push(partner);
                pairUsers();
            }
        }, 10000); // Wait 10 seconds before re-queuing the partner
    } else {
        const index = waitingQueue.indexOf(user);
        if (index > -1) {
            waitingQueue.splice(index, 1);
        }
    }
}

function sendMessage(user, message) {
    if (user.readyState === WebSocket.OPEN) {
        user.send(JSON.stringify(message));
    }
}

wss.on('connection', (ws) => {
    console.log('New user connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'ping') {
                sendMessage(ws, { type: 'pong' });
                return; // Skip further processing
            }
            switch (data.type) {
                case 'ready':
                    waitingQueue.push(ws);
                    sendMessage(ws, { type: 'waiting' });
                    pairUsers();
                    break;
                case 'next':
                    handleNext(ws);
                    break;
                case 'disconnected':
                    handleDisconnect(ws);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                case 'blur-preference':
                case 'chat':
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
        console.log(`User disconnected. Code: ${code}, Reason: ${reason}`);
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

// Log the state of the server every 5 seconds
setInterval(() => {
    console.log('Server state:');
    console.log('  Connected clients:', wss.clients.size);
    console.log('  Waiting queue length:', waitingQueue.length);
    console.log('  Connected pairs:', connectedPairs.size / 2);
}, 5000);

function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    // Existing code...
});

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