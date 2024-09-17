const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startChatButton = document.getElementById('startChatButton');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');

let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];
let messageQueue = [];

const configuration = {
    iceServers: [
        { urls: 'stun:fr-turn1.xirsys.com' },
        {
            username: "NtUxUgJUFwDb1LrBQAXzLGpsqx9PBXQQnEa0a1s2LL3T93oSqD2a3jC1gqM1SG27AAAAAGbjXnBjaHJpamFxdWU=",
            credential: "d11f86be-714e-11ef-8726-0242ac120004",
            urls: [
                "turn:fr-turn1.xirsys.com:80?transport=udp",
                "turn:fr-turn1.xirsys.com:3478?transport=udp",
                "turn:fr-turn1.xirsys.com:80?transport=tcp",
                "turn:fr-turn1.xirsys.com:3478?transport=tcp",
                "turns:fr-turn1.xirsys.com:443?transport=tcp",
                "turns:fr-turn1.xirsys.com:5349?transport=tcp"
            ]
        }
    ]
};

// WebSocket setup
let socket;
let socketReady = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 5000;

function setupWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');

    socket.onopen = () => {
        console.log('WebSocket connected');
        socketReady = true;
        reconnectAttempts = 0;
        processMessageQueue(); // Process any queued messages once socket is ready
        setupLocalStream()
            .then(() => {
                sendMessage({ type: 'ready' });
            })
            .catch(error => {
                console.error('Failed to set up local stream:', error);
            });
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        socketReady = false;
        if (reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
            setTimeout(setupWebSocket, reconnectInterval);
            reconnectAttempts++;
        } else {
            console.error('Max reconnect attempts reached. Please refresh the page.');
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    socket.onmessage = handleIncomingMessage;
}

function processMessageQueue() {
    if (socket.readyState === WebSocket.OPEN) {
        messageQueue.forEach(message => socket.send(JSON.stringify(message)));
        messageQueue = [];
    }
}

// Call this function when the page loads
document.addEventListener('DOMContentLoaded', () => {
    setupWebSocket();
    setupChat();
    setupUIElements();
});

function setupUIElements() {
    const toggleBlurButton = document.getElementById('toggleBlurButton');
    if (toggleBlurButton) {
        toggleBlurButton.addEventListener('click', toggleBlur);
    } else {
        console.error('Toggle blur button not found');
    }
}

function setupChat() {
    console.log('Setting up chat');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendMessageButton');
    const chatMessages = document.getElementById('chatMessages');

    if (chatInput && sendButton && chatMessages) {
        sendButton.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendChatMessage();
            }
        });
    } else {
        console.error('Some chat elements are missing');
    }
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) {
        console.error('Chat input element not found');
        return;
    }
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    switch (data.type) {
        case 'waiting':
            console.log('Waiting for peer...');
            break;
        case 'connected':
            console.log('Peer connected, isOfferer:', data.isOfferer);
            startConnection(data.isOfferer);
            break;
        case 'offer':
            handleOffer(data.offer);
            break;
        case 'answer':
            handleAnswer(data.answer);
            break;
        case 'ice-candidate':
            handleIceCandidate(data.candidate);
            break;
        case 'chat':
            addMessageToChat('Peer', data.message);
            break;
        case 'blur-preference':
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

async function handleOffer(offer) {
    if (!peerConnection) createPeerConnection();
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage({ type: 'answer', answer: peerConnection.localDescription });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error('Error handling answer:', error);
    }
}

function handleIceCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => console.error('Error adding ICE candidate:', e));
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        messageQueue.push(message); // Queue message until WebSocket is open
    }
}

function startConnection(isOfferer) {
    if (!localStream) {
        setupLocalStream().then(() => {
            createPeerConnection();
            proceedWithOfferOrAnswer(isOfferer);
        });
    } else {
        createPeerConnection();
        proceedWithOfferOrAnswer(isOfferer);
    }
}

function proceedWithOfferOrAnswer(isOfferer) {
    if (isOfferer) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => sendMessage({ type: 'offer', offer: peerConnection.localDescription }));
    } else {
        console.log('Waiting for offer as answerer');
    }
}

function createPeerConnection() {
    if (peerConnection) peerConnection.close();
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) sendMessage({ type: 'ice-candidate', candidate: event.candidate });
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'connected') {
            iceCandidatesQueue.forEach(candidate => {
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            });
            iceCandidatesQueue = [];
        }
    };

    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
        applyInitialBlur();
    };

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    } else {
        console.error('Local stream not available when creating peer connection');
    }
}

// Disconnect logic
disconnectButton.addEventListener('click', () => {
    if (peerConnection) peerConnection.close();
    remoteVideo.srcObject = null;
    sendMessage({ type: 'disconnected' });
});

// Next button to reset the connection
nextButton.addEventListener('click', () => {
    disconnectButton.click();
    sendMessage({ type: 'ready' });
});

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
const removeBlurButton = document.getElementById('removeBlurButton');

function toggleBlur() {
    localWantsBlurOff = !localWantsBlurOff;
    updateBlurState();
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    
    if (localVideo && remoteVideo && removeBlurButton) {
        if (localWantsBlurOff && remoteWantsBlurOff) {
            localVideo.style.filter = 'none';
            remoteVideo.style.filter = 'none';
            removeBlurButton.textContent = 'DAAAAMN!';
            removeBlurButton.style.backgroundColor = 'blue';
            removeBlurButton.style.color = 'white';
        } else {
            localVideo.style.filter = 'blur(10px)';
            remoteVideo.style.filter = 'blur(10px)';
            removeBlurButton.textContent = 'Remove Blur';
            removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? 'green' : '';
            removeBlurButton.style.color = '';
        }
    } else {
        console.error('Video elements or remove blur button not found');
    }
}

// UI element setup for toggling blur
function setupUIElements() {
    const removeBlurButton = document.getElementById('removeBlurButton');
    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', toggleBlur);
    }
}

function setupLocalStream() {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            localVideo.srcObject = stream;
            localVideo.play().catch(e => console.error('Error playing local video:', e));
            return stream;
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
            throw error;
        });
}

window.onbeforeunload = () => {
    if (peerConnection) peerConnection.close();
    if (socket) socket.close();
};

function addMessageToChat(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.textContent = `${sender}: ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.addEventListener('DOMContentLoaded', () => {
    setupWebSocket();
    setupChat();
    setupUIElements();
    const removeBlurButton = document.getElementById('removeBlurButton');
    removeBlurButton.addEventListener('click', toggleBlur);
});