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
            
            sendMessage(user1, { type: 'paired' });
            sendMessage(user2, { type: 'paired' });
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
        if (partner.readyState === WebSocket.OPEN) {
            waitingQueue.push(partner);
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
        if (partner.readyState === WebSocket.OPEN) {
            waitingQueue.push(partner);
            pairUsers();
        }
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
            console.log('Received message:', data);
            
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
                    if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
                        sendMessage(ws.partner, data);
                    }
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('User disconnected');
        handleDisconnect(ws);
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
    console.log('  Connected pairs:', connectedPairs.size);
}, 5000);