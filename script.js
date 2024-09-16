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
let connectionState = 'new'; // 'new', 'connecting', 'connected', 'disconnected', 'closed'

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
        if (connectionState === 'new' || connectionState === 'disconnected') {
            startConnection();
        }
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        socketReady = false;
        if (reconnectAttempts < maxReconnectAttempts) {
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

    // Add other UI element setups here
}

function setupChat() {
    console.log('Setting up chat');
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendMessageButton');
    const chatMessages = document.getElementById('chatMessages');

    console.log('Chat input found:', !!chatInput);
    console.log('Send button found:', !!sendButton);
    console.log('Chat messages container found:', !!chatMessages);

    if (chatInput && sendButton && chatMessages) {
        sendButton.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                sendChatMessage();
            }
        });
        console.log('Chat event listeners set up');
    } else {
        console.error('Some chat elements are missing');
    }
}

function sendChatMessage() {
    console.log('sendChatMessage function called');
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) {
        console.error('Chat input element not found');
        return;
    }
    const message = chatInput.value.trim();
    if (message) {
        console.log('Attempting to send message:', message);
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

function handleIncomingMessage(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);

        switch(data.type) {
            case 'offer':
                if (connectionState !== 'new' && connectionState !== 'disconnected') {
                    console.log('Unexpected offer. Current state:', connectionState);
                    return;
                }
                handleOffer(data.offer);
                break;
            case 'answer':
                if (connectionState !== 'connecting') {
                    console.log('Unexpected answer. Current state:', connectionState);
                    return;
                }
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
        }
    } catch (error) {
        console.error('Error parsing incoming message:', error);
    }
}

async function handleOffer(offer) {
    try {
        createPeerConnection();
        updateConnectionState('connecting');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage({ type: 'answer', answer: peerConnection.localDescription });
        iceCandidatesQueue.forEach(candidate => peerConnection.addIceCandidate(candidate).catch(e => console.error('Error adding queued candidate:', e)));
        iceCandidatesQueue = [];
    } catch (error) {
        console.error('Error handling offer:', error);
        updateConnectionState('disconnected');
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        iceCandidatesQueue.forEach(candidate => peerConnection.addIceCandidate(candidate).catch(e => console.error('Error adding queued candidate:', e)));
        iceCandidatesQueue = [];
    } catch (error) {
        console.error('Error handling answer:', error);
        updateConnectionState('disconnected');
    }
}

function handleIceCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(error => console.error('Error adding received ice candidate:', error));
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

function sendMessage(message) {
    console.log('sendMessage function called with:', message);
    if (socketReady) {
        socket.send(JSON.stringify(message));
        console.log('Message sent:', message);
    } else {
        console.log('WebSocket not ready. Queueing message:', message);
        messageQueue.push(message);
    }
}

function sendQueuedMessages() {
    while (messageQueue.length > 0 && socketReady) {
        const message = messageQueue.shift();
        sendMessage(message);
    }
}

function startChat() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = localStream;
                toggleBlur(localVideo, true);
            } else {
                console.error('Local video element not found');
            }
            createPeerConnection();
            sendMessage({ type: 'ready' });
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
            updateStatus('Error accessing media devices');
        });
}

function createPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }
    peerConnection = new RTCPeerConnection(configuration);
    updateConnectionState('new');

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'connected') {
            updateConnectionState('connected');
        } else if (peerConnection.iceConnectionState === 'disconnected' || 
                   peerConnection.iceConnectionState === 'failed') {
            updateConnectionState('disconnected');
            handleConnectionLoss();
        }
    };

    peerConnection.ontrack = event => {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            toggleBlur(remoteVideo, true);
        }
    };

    // Add local stream
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    console.log('Peer connection created');
}

function startConnection() {
    createPeerConnection();
    updateConnectionState('connecting');
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        })
        .catch(error => {
            console.error('Error creating offer:', error);
            updateConnectionState('disconnected');
        });
}

function handleConnectionLoss() {
    console.log('Handling connection loss');
    if (connectionState !== 'disconnected') {
        updateConnectionState('disconnected');
        setTimeout(() => {
            if (connectionState === 'disconnected') {
                startConnection();
            }
        }, 5000); // Wait 5 seconds before attempting to reconnect
    }
}

// Disconnect logic
disconnectButton.addEventListener('click', () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    sendMessage({ type: 'disconnected' });
});

// Next button to reset the connection
nextButton.addEventListener('click', () => {
    disconnectButton.click(); // Trigger disconnect
    statusMessage.textContent = 'Searching for a new peer...';
    sendMessage({ type: 'ready' }); // Send ready again for a new connection
});

let localWantsBlurOff = false;
let remoteWantsBlurOff = false;

function applyInitialBlur() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    toggleBlur(localVideo, true);
    toggleBlur(remoteVideo, true);
}

function toggleBlur(video, enabled) {
    if (video) {
        video.style.filter = enabled ? 'blur(10px)' : 'none';
    }
}

function updateBlurState() {
    console.log('Updating blur state');
    console.log('Local wants blur off:', localWantsBlurOff);
    console.log('Remote wants blur off:', remoteWantsBlurOff);
    
    const shouldRemoveBlur = localWantsBlurOff && remoteWantsBlurOff;
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    toggleBlur(localVideo, !shouldRemoveBlur);
    toggleBlur(remoteVideo, !shouldRemoveBlur);
    
    const removeBlurButton = document.getElementById('removeBlurButton');
    if (removeBlurButton) {
        removeBlurButton.textContent = localWantsBlurOff ? "Re-enable Blur" : "Remove Blur";
        removeBlurButton.style.backgroundColor = remoteWantsBlurOff ? "green" : "";
    }
}

function setupUIElements() {
    const removeBlurButton = document.getElementById('removeBlurButton');
    if (removeBlurButton) {
        removeBlurButton.addEventListener('click', () => {
            localWantsBlurOff = !localWantsBlurOff;
            sendMessage({ type: 'blur-preference', wantsBlurOff: localWantsBlurOff });
            updateBlurState();
        });
    }
}

// Call this function when the page loads and when the remote stream is added
applyInitialBlur();

function updateStatus(message) {
    const statusMessage = document.getElementById('statusMessage');
    if (statusMessage) {
        statusMessage.textContent = message;
    } else {
        console.error('Status message element not found');
    }
}

function addMessageToChat(sender, message) {
    console.log('Adding message to chat:', sender, message);
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        const messageElement = document.createElement('div');
        messageElement.textContent = `${sender}: ${message}`;
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else {
        console.error('Chat messages container not found');
    }
}

window.onbeforeunload = () => {
    if (peerConnection) {
        peerConnection.close();
    }
    if (socket) {
        socket.close();
    }
};
