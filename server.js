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
        
        user1.partner = user2;
        user2.partner = user1;
        
        connectedPairs.set(user1, user2);
        connectedPairs.set(user2, user1);
        
        user1.send(JSON.stringify({ type: 'paired' }));
        user2.send(JSON.stringify({ type: 'paired' }));
    }
}

function handleNext(user) {
    const partner = connectedPairs.get(user);
    if (partner) {
        partner.send(JSON.stringify({ type: 'partnerDisconnected' }));
        connectedPairs.delete(user);
        connectedPairs.delete(partner);
        waitingQueue.push(partner);
    }
    waitingQueue.push(user);
    pairUsers();
}

wss.on('connection', (ws) => {
    console.log('New user connected');
    
    waitingQueue.push(ws);
    pairUsers();

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'next':
                handleNext(ws);
                break;
            case 'offer':
            case 'answer':
            case 'ice-candidate':
            case 'blur-preference':
                if (ws.partner) {
                    ws.partner.send(message);
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log('User disconnected');
        const partner = connectedPairs.get(ws);
        if (partner) {
            partner.send(JSON.stringify({ type: 'partnerDisconnected' }));
            connectedPairs.delete(ws);
            connectedPairs.delete(partner);
            waitingQueue.push(partner);
            pairUsers();
        } else {
            const index = waitingQueue.indexOf(ws);
            if (index > -1) {
                waitingQueue.splice(index, 1);
            }
        }
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});