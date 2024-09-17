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
    ],
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10
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
    console.log('DOM fully loaded');
    setupWebSocket();
    setupChat();
    setupBlurEffect();
});

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
let removeBlurButton;

function setupBlurEffect() {
    removeBlurButton = document.getElementById('removeBlurButton');
    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', toggleBlur);
        console.log('Blur effect setup complete');
    } else {
        console.error('Remove blur button not found');
        // Attempt to find the button by other means
        const buttons = document.getElementsByTagName('button');
        for (let button of buttons) {
            if (button.textContent.toLowerCase().includes('remove blur')) {
                removeBlurButton = button;
                removeBlurButton.addEventListener('click', toggleBlur);
                console.log('Remove blur button found and set up');
                break;
            }
        }
    }
    applyInitialBlur();
}

function applyInitialBlur() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    if (localVideo) localVideo.style.filter = 'blur(10px)';
    if (remoteVideo) remoteVideo.style.filter = 'blur(10px)';
    console.log('Initial blur applied');
}

function toggleBlur() {
    console.log('Toggle blur called');
    if (!removeBlurButton) {
        console.error('Remove blur button not found');
        return;
    }
    localWantsBlurOff = !localWantsBlurOff;
    updateBlurState();
    sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    
    if (!localVideo || !remoteVideo) {
        console.error('Video elements not found');
        return;
    }

    if (!removeBlurButton) {
        console.error('Remove blur button not found');
        return;
    }

    console.log('Updating blur state:', { localWantsBlurOff, remoteWantsBlurOff });

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
    console.log('Blur state updated');
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

    switch(data.type) {
        case 'waiting':
            console.log('Waiting for peer...');
            break;
        case 'connected':
            console.log('Peer connected, isOfferer:', data.isOfferer);
            startConnection(data.isOfferer);
            break;
        case 'offer':
            console.log('Received offer');
            handleOffer(data.offer);
            break;
        case 'answer':
            console.log('Received answer');
            handleAnswer(data.answer);
            break;
        case 'ice-candidate':
            console.log('Received ICE candidate');
            handleIceCandidate(data.candidate);
            break;
        case 'ready':
            console.log('Peer is ready');
            // You might want to add logic here to start the connection if both peers are ready
            break;
        case 'blur-preference':
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
            break;
        case 'chat':
            addMessageToChat('Peer', data.message);
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
        if (peerConnection.signalingState !== "have-local-offer") {
            console.warn('Unexpected signaling state when receiving answer:', peerConnection.signalingState);
            return;
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Remote description set successfully');
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
        console.log('Sent message:', message);
    } else {
        console.warn('WebSocket is not open. Message not sent:', message);
        // Optionally, you could queue messages here to send when the connection is ready
    }
}

function startConnection(isOfferer) {
    createPeerConnection();
    
    if (isOfferer) {
        console.log('Creating offer as offerer');
        peerConnection.createOffer()
            .then(offer => {
                console.log('Setting local description');
                return peerConnection.setLocalDescription(offer);
            })
            .then(() => {
                console.log('Sending offer');
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => {
                console.error('Error creating offer:', error);
            });
    } else {
        console.log('Waiting for offer as answerer');
    }
}

function createPeerConnection() {
    console.log('Creating peer connection');
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(configuration);
    console.log('New peer connection created');

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state changed:', peerConnection.iceConnectionState);
    };

    peerConnection.ontrack = event => {
        console.log('Received remote track');
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && event.streams && event.streams[0]) {
            console.log('Setting remote video stream');
            remoteVideo.srcObject = event.streams[0];
            updateBlurState();
        }
    };

    if (localStream) {
        console.log('Adding local stream tracks to peer connection');
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.error('Local stream not available when creating peer connection');
    }

    console.log('Peer connection setup completed');
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