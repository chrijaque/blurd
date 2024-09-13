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
        { urls: 'stun:stun.l.google.com:19302' },
        {
            username: "YOUR_XIRSYS_USERNAME",
            credential: "YOUR_XIRSYS_CREDENTIAL",
            urls: [
                "turn:fr-turn1.xirsys.com:80?transport=udp",
                "turn:fr-turn1.xirsys.com:3478?transport=udp",
                "turns:fr-turn1.xirsys.com:443?transport=tcp",
            ]
        }
    ]
};

// Initialize WebSocket
function initWebSocket() {
    socket = new WebSocket('wss://your-websocket-url');

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
            if (peerConnection.remoteDescription) {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } else {
                iceCandidatesQueue.push(data.candidate);
            }
            break;
    }
}

// Create a WebRTC connection and add the local stream to it
function startWebRTC() {
    if (!localStream) {
        console.error('Local stream is not available');
        return;
    }

    peerConnection = new RTCPeerConnection(configuration);

    // Ensure localStream is defined before accessing it
    if (localStream) {
        localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    } else {
        console.error('Cannot access localStream');
    }

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
        if (peerConnection.iceConnectionState === 'disconnected') {
            handleDisconnect();
        }
    };
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
}