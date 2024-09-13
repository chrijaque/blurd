const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startChatButton = document.getElementById('startChatButton');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');

let localStream;
let peerConnection;
let socket;
let isOfferer = false;
let iceCandidatesQueue = [];

// WebRTC configuration using STUN and TURN servers
const configuration = {
    iceServers: [
        { urls: 'stun:fr-turn1.xirsys.com' },
        {
            username: "NtUxUgJUFwDb1LrBQAXzLGpsqx9PBXQQnEa0a1s2LL3T93oSqD2a3jC1gqM1SG27AAAAAGbjXnBjaHJpamFxdWU=", // Replace with actual username
            credential: "d11f86be-714e-11ef-8726-0242ac120004", // Replace with actual credential
            urls: [
                "turn:fr-turn1.xirsys.com:80?transport=udp",
                "turn:fr-turn1.xirsys.com:3478?transport=udp",
                "turn:fr-turn1.xirsys.com:80?transport=tcp",
                "turn:fr-turn1.xirsys.com:3478?transport=tcp",
                "turns:fr-turn1.xirsys.com:443?transport=tcp",
                "turns:fr-turn1.xirsys.com:5349?transport=tcp",
            ]
        }
    ]
};

// Initialize WebSocket
function initWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app'); // Replace with actual WebSocket URL

    socket.onopen = () => {
        console.log('WebSocket connected');
        sendMessage({ type: 'ready' });
    };

    socket.onmessage = handleSignalingMessage;
    socket.onerror = (error) => console.error('WebSocket error:', error);
    socket.onclose = () => console.log('WebSocket closed');
}

initWebSocket();

// Start the chat and initialize the video stream
startChatButton.addEventListener('click', () => {
    startChatButton.disabled = true;

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
            localStream = stream;
            localVideo.srcObject = stream;

            // Notify the server that we're ready to start
            sendMessage({ type: 'ready' });
        })
        .catch((error) => {
            console.error('Error accessing media devices:', error);
        });
});

// Handle incoming WebSocket messages
function handleSignalingMessage(message) {
    const data = JSON.parse(message.data);

    switch (data.type) {
        case 'connected':
            isOfferer = data.isOfferer;
            startWebRTC();
            if (isOfferer) createOffer();
            break;
        case 'offer':
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
                .then(() => peerConnection.createAnswer())
                .then((answer) => peerConnection.setLocalDescription(answer))
                .then(() => sendMessage({ type: 'answer', answer: peerConnection.localDescription }));
            break;
        case 'answer':
            peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            break;
        case 'ice-candidate':
            handleIceCandidate(data.candidate);
            break;
    }
}

function handleIceCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => console.error('Error adding ICE candidate:', error));
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

// Create a WebRTC connection and add the local stream to it
function startWebRTC() {
    if (!localStream) {
        console.error('Local stream is not available');
        return;
    }

    peerConnection = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'closed') {
            handleDisconnect();
        }
    };

    // Process any queued ICE candidates
    while (iceCandidatesQueue.length) {
        const candidate = iceCandidatesQueue.shift();
        handleIceCandidate(candidate);
    }
}

// Create an offer if the user is the offerer
function createOffer() {
    peerConnection.createOffer()
        .then((offer) => peerConnection.setLocalDescription(offer))
        .then(() => sendMessage({ type: 'offer', offer: peerConnection.localDescription }));
}

// Handle WebSocket messages and ICE candidate exchange
function sendMessage(message) {
    socket.send(JSON.stringify(message));
}

// Disconnect logic
function handleDisconnect() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // Reset UI elements and prepare for a new connection
    startChatButton.disabled = false;
    remoteVideo.srcObject = null;
    console.log('Disconnected from peer');
}