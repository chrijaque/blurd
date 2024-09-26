// Landing page elements
const localVideoPreview = document.getElementById('localVideoPreview');
const toggleBlurButton = document.getElementById('toggleBlurButton');
const usernameInput = document.getElementById('usernameInput');
const termsCheckbox = document.getElementById('termsCheckbox');
const startChatButton = document.getElementById('startChatButton');

// Chat interface elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const nextButton = document.getElementById('nextButton');
const disconnectButton = document.getElementById('disconnectButton');
const statusMessage = document.getElementById('statusMessage');
const removeBlurButton = document.getElementById('removeBlurButton');
const toggleAudioButton = document.getElementById('toggleAudioButton');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendMessageButton');
const chatMessages = document.getElementById('chatMessages');

// Variables
let localStream;
let peerConnection;
let isOfferer = false;
let iceCandidatesQueue = [];
let makingOffer = false;
let ignoreOffer = false;
let polite = false; // Will be set based on your role
let isBlurred = true; // For preview
let localWantsBlurOff = false;
let remoteWantsBlurOff = false;
let isConnectedToPeer = false;
let dataChannel;
let isAudioEnabled = false;
let username = '';

// WebSocket setup
let socket;
let socketReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let heartbeatInterval;
let intentionalDisconnect = false; // Added flag to track intentional disconnects

// Landing Page Functions
async function setupLocalPreview() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localVideoPreview.srcObject = localStream;
        applyBlurEffectPreview();
        console.log('Camera accessed successfully for preview');
    } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Unable to access camera. Please ensure you have given permission and try again.');
    }
}

function applyBlurEffectPreview() {
    localVideoPreview.style.filter = isBlurred ? 'blur(10px)' : 'none';
}

toggleBlurButton.addEventListener('click', () => {
    isBlurred = !isBlurred;
    applyBlurEffectPreview();
});

function updateStartChatButton() {
    startChatButton.disabled = !(usernameInput.value.trim() && termsCheckbox.checked);
    console.log('Start Chat button state updated:', !startChatButton.disabled);
}

usernameInput.addEventListener('input', updateStartChatButton);
termsCheckbox.addEventListener('change', updateStartChatButton);

startChatButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && termsCheckbox.checked) {
        localStorage.setItem('username', username);
        startChat();
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    setupLocalPreview();
    updateStartChatButton(); // Initial check
});

// Chat Initialization Functions
async function initializeChat() {
    console.log('Initializing chat');
    try {
        await initializeConnection();
        console.log('Connection initialized successfully');
        setupChat();
        console.log('Chat setup complete');
    } catch (error) {
        console.error('Error in initializeChat:', error);
    }
}

async function initializeConnection() {
    console.log('Initializing connection');
    try {
        const constraints = { video: true, audio: true };
        try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (audioError) {
            console.warn('Audio device not found, trying video only');
            constraints.audio = false;
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        
        localVideo.srcObject = localStream;
        console.log('Local stream set up successfully');
        console.log('Local stream tracks:', localStream.getTracks().map(t => t.kind));
        
        // Start the WebSocket connection after getting the local stream
        setupWebSocket();
    } catch (error) {
        console.error('Error setting up local stream:', error);
        handleMediaError(error);
    }
}

function handleMediaError(error) {
    let errorMessage = '';
    switch(error.name) {
        case 'NotFoundError':
            errorMessage = 'Camera or microphone not found. Please ensure your devices are connected and permissions are granted.';
            break;
        case 'NotAllowedError':
            errorMessage = 'Permission to use camera and microphone was denied. Please allow access and try again.';
            break;
        case 'NotReadableError':
            errorMessage = 'Your camera or microphone is already in use by another application.';
            break;
        default:
            errorMessage = `An error occurred while trying to access your camera and microphone: ${error.message}`;
    }
    console.error(errorMessage);
    alert(errorMessage);
    // You might want to update the UI to reflect this error state
}

function createPeerConnection() {
    console.log('Creating peer connection');
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = handleICECandidate;
    peerConnection.ontrack = handleTrack;
    peerConnection.oniceconnectionstatechange = handleICEConnectionStateChange;
    const configuration = {
        iceServers: [
            { urls: 'stun:fr-turn1.xirsys.com' },
            {
                urls: [
                    'turn:fr-turn1.xirsys.com:80?transport=udp',
                    'turn:fr-turn1.xirsys.com:3478?transport=udp',
                    'turn:fr-turn1.xirsys.com:80?transport=tcp',
                    'turn:fr-turn1.xirsys.com:3478?transport=tcp',
                    'turns:fr-turn1.xirsys.com:443?transport=tcp',
                    'turns:fr-turn1.xirsys.com:5349?transport=tcp'
                ],
                username: 'NtUxUgJUFwDb1LrBQAXzLGpsqx9PBXQQnEa0a1s2LL3T93oSqD2a3jC1gqM1SG27AAAAAGbjXnBjaHJpamFxdWU=',
                credential: 'd11f86be-714e-11ef-8726-0242ac120004'
            }
        ],
        iceCandidatePoolSize: 10,
    };

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        console.log('Adding local track to peer connection:', track.kind);
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming tracks
    peerConnection.ontrack = handleTrack;

    function handleTrack(event) {
        console.log('Received remote track:', event.track.kind);
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log('Set remote video source');
            event.streams[0].onaddtrack = () => console.log('New track added to remote stream');
        }
        remoteVideo.onloadedmetadata = () => console.log('Remote video metadata loaded');
        remoteVideo.onplay = () => console.log('Remote video started playing');
    }

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = event => {
        console.log('Received remote track', event);
        if (event.track.kind === 'video') {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                console.log('Setting remote video stream');
            }
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            makingOffer = true;
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        } catch (err) {
            console.error('Error during negotiationneeded event:', err);
        } finally {
            makingOffer = false;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.log('ICE connection failed, restarting');
            restartIce();
        } else if (peerConnection.iceConnectionState === 'connected') {
            console.log('ICE connection established');
            checkRelayConnection();
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            console.log('ICE connection disconnected, attempting to reconnect');
            setTimeout(restartIce, 2000);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state change:', peerConnection.connectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log('ICE gathering state:', peerConnection.iceGatheringState);
    };

    // Set up data channel based on role
    if (!polite) {
        // Offerer creates the data channel
        dataChannel = peerConnection.createDataChannel('chat');
        setupDataChannel();
    } else {
        // Answerer listens for data channel
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel();
        };
    }

    console.log('Peer connection created');
}

function setupWebSocket() {
    socket = new WebSocket('https://blurd.adaptable.app');
    
    socket.onopen = () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        // Send any necessary initialization messages
        sendMessage({ type: 'ready', username: username });
    };
    
    socket.onclose = (event) => {
        console.log('WebSocket disconnected, attempting to reconnect...');
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            setTimeout(setupWebSocket, 5000);
            reconnectAttempts++;
        } else {
            console.error('Max reconnection attempts reached');
            updateUIConnectionState('Connection failed');
        }
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    socket.onmessage = handleIncomingMessage;
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        }
    }, 15000); // Every 15 seconds
}

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        message.username = username;
        socket.send(JSON.stringify(message));
        console.log('Sent message:', message);
    } else {
        console.log('WebSocket not ready. Message not sent:', message);
    }
}

function handleIncomingMessage(event) {
    const data = JSON.parse(event.data);
    console.log('Received message:', data);

    switch (data.type) {
        case 'waiting':
            updateUIConnectionState('Waiting for peer...');
            break;
        case 'paired':
            updateUIConnectionState('Connected to peer');
            startConnection(data.isOfferer);
            break;
        case 'offer':
            handleOfferOrAnswer(data.offer, true);
            break;
        case 'answer':
            handleOfferOrAnswer(data.answer, false);
            break;
        case 'candidate':
            handleNewICECandidate(data.candidate);
            break;
        case 'chat':
            addMessageToChat('Partner', data.message);
            break;
        case 'pong':
            // Handle pong (if needed)
            break;
        case 'partnerDisconnected':
            handlePartnerDisconnect();
            break;
        default:
            console.warn('Unknown message type:', data.type);
    }
}

function updateUIConnectionState(state) {
    const stateElement = document.getElementById('connectionState');
    if (stateElement) {
        stateElement.textContent = state;
    }
}

// Peer Connection and RTC Functions
function startConnection(isOfferer) {
    console.log('Starting connection, isOfferer:', isOfferer);
    createPeerConnection();
    
    if (isOfferer) {
        createAndSendOffer();
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.onicecandidate = handleICECandidate;
    peerConnection.ontrack = handleTrack;
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    console.log('Peer connection created');
}

function createAndSendOffer() {
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            console.log('Sending offer');
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        })
        .catch(error => console.error('Error creating offer:', error));
}

function handleOfferOrAnswer(description, isOffer) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(description))
        .then(() => {
            if (isOffer) {
                return peerConnection.createAnswer();
            }
        })
        .then(answer => {
            if (answer) {
                return peerConnection.setLocalDescription(answer);
            }
        })
        .then(() => {
            if (isOffer) {
                sendMessage({ type: 'answer', answer: peerConnection.localDescription });
            }
        })
        .catch(error => console.error('Error handling offer/answer:', error));
}

function handleIceCandidate(event) {
    console.log('Handling ICE candidate:', JSON.stringify(event.candidate));
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        peerConnection.addIceCandidate(event.candidate)
            .then(() => console.log('ICE candidate added successfully'))
            .catch(e => console.error('Error adding received ice candidate', e));
    } else {
        console.log('Queueing ICE candidate');
        iceCandidatesQueue.push(event.candidate);
    }
}

function setupDataChannel() {
    if (peerConnection.createDataChannel) {
        dataChannel = peerConnection.createDataChannel('chat');
        dataChannel.onopen = () => console.log('Data channel opened');
        dataChannel.onclose = () => console.log('Data channel closed');
        dataChannel.onmessage = handleDataChannelMessage;
    } else {
        console.error('Data channels are not supported');
    }
}

function handleDataChannelMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Received data channel message:', message);
    if (message.type === 'blurState') {
        remoteWantsBlurOff = message.blurState;
        updateBlurState();
    }
}

// Chat Functions
function setupChat() {
    console.log('Setting up chat');

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

    toggleAudioButton.addEventListener('click', toggleAudio);
    nextButton.addEventListener('click', handleNext);
    disconnectButton.addEventListener('click', handleDisconnect);
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message) {
        sendMessage({ type: 'chat', message: message });
        addMessageToChat('You', message);
        chatInput.value = '';
    } else {
        console.log('Empty message, not sending');
    }
}

function addMessageToChat(sender, message) {
    const messageElement = document.createElement('div');
    
    if (sender === 'System') {
        messageElement.style.fontStyle = 'italic';
        messageElement.style.color = '#888';
    }
    
    messageElement.textContent = `${sender === 'System' ? '' : sender + ': '}${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearChat() {
    if (chatMessages) {
        chatMessages.innerHTML = '';
    } else {
        console.error('Chat messages element not found');
    }
}

function resetBlurState() {
    remoteWantsBlurOff = false;
    updateBlurState();
}

function updateBlurState() {
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');

    if (localWantsBlurOff) {
        localVideo.style.filter = 'none';
    } else {
        localVideo.style.filter = 'blur(10px)';
    }

    if (remoteWantsBlurOff) {
        remoteVideo.style.filter = 'none';
    } else {
        remoteVideo.style.filter = 'blur(10px)';
    }

    console.log('Blur state updated');
}

function toggleBlur() {
    console.log('Toggle blur called');
    if (!removeBlurButton || removeBlurButton.disabled || !peerConnection || !dataChannel || dataChannel.readyState !== 'open') {
        console.log('Remove blur button is disabled, not found, or data channel not ready');
        return;
    }
    localWantsBlurOff = !localWantsBlurOff;
    console.log('Local wants blur off:', localWantsBlurOff);
    updateBlurState();
    sendBlurState();
}

function sendBlurState() {
    if (dataChannel && dataChannel.readyState === 'open') {
        const message = JSON.stringify({ type: 'blurState', blurState: localWantsBlurOff });
        dataChannel.send(message);
        console.log('Sent blur state:', message);
    } else {
        console.log('Data channel is not open. Cannot send blur state.');
    }
}

// Audio Control Functions
function toggleAudio() {
    if (localStream) {
        isAudioEnabled = !isAudioEnabled;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioEnabled;
        });
        toggleAudioButton.textContent = isAudioEnabled ? 'Disable Audio' : 'Enable Audio';
        notifyAudioStateChange();
    }
}

function notifyAudioStateChange() {
    sendMessage({ type: 'audio-state', enabled: isAudioEnabled });
}

// Connection Control Functions
function handlePartnerDisconnect() {
    if (!isConnectedToPeer) return;
    isConnectedToPeer = false;
    console.log('Handling partner disconnect');

    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.onnegotiationneeded = null;

        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo) {
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
    }
    // Reset blur state
    remoteWantsBlurOff = false;
    updateBlurState();
    console.log('Disconnected from peer');

    // Automatically attempt to find a new partner
    intentionalDisconnect = false; // Ensure the flag is false
    sendMessage({ type: 'ready' });
}

function handleNext() {
    console.log('Next button clicked');
    clearChat();
    resetBlurState();
    sendMessage({ type: 'next' });
    handlePartnerDisconnect();
    // Do not close the WebSocket
}

function handleDisconnect() {
    console.log('Disconnect button clicked');
    clearChat();
    intentionalDisconnect = true;
    sendMessage({ type: 'disconnected' });
    handlePartnerDisconnect();
    if (socket) socket.close(); // Close the WebSocket only on full disconnect
}

function updateConnectionStatus() {
    if (peerConnection && peerConnection.iceConnectionState === 'connected') {
        statusMessage.textContent = 'Connected to a peer';
    } else {
        statusMessage.textContent = 'Waiting for peer...';
    }
}

window.onbeforeunload = () => {
    if (peerConnection) peerConnection.close();
    if (socket) socket.close();
};

function startChat() {
    const landingPage = document.getElementById('landingPage');
    const chatPage = document.getElementById('chatPage');
    const usernameInput = document.getElementById('usernameInput');

    // Capture the username
    username = usernameInput.value || 'Anonymous';

        // Apply fade-out animation to landing page
        landingPage.classList.add('fade-out');

        // After the fade-out animation completes, hide the landing page and show the chat page
        setTimeout(() => {
            landingPage.style.display = 'none';
            landingPage.classList.remove('fade-out');
    
            // Show the chat page and apply fade-in animation
            chatPage.style.display = 'block';
            chatPage.classList.add('fade-in');
    
            // Remove the fade-in class after the animation completes to reset the state
            setTimeout(() => {
                chatPage.classList.remove('fade-in');
            }, 500); // Match the duration of the fade-in animation
    
            // Proceed with initializing the chat functionalities
            initializeChat();
        }, 500); // Match the duration of the fade-out animation
    }


function setupBlurEffect() {
    console.log('Setting up blur effect');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const removeBlurButton = document.getElementById('removeBlurButton');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    // Apply initial blur
    localVideo.style.filter = 'blur(10px)';
    remoteVideo.style.filter = 'blur(10px)';

    removeBlurButton.addEventListener('click', toggleBlur);
    console.log('Blur effect setup complete');
}

function restartIce() {
    if (peerConnection) {
        console.log('Restarting ICE connection');
        peerConnection.restartIce();
        peerConnection.createOffer({ iceRestart: true })
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error during ICE restart:', error));
    }
}

function checkConnectionStatus() {
    if (peerConnection) {
        console.log('Connection status:', peerConnection.connectionState);
        console.log('ICE connection state:', peerConnection.iceConnectionState);
        console.log('Signaling state:', peerConnection.signalingState);
    }
}

function checkRelayConnection() {
    if (peerConnection) {
        peerConnection.getStats(null).then(stats => {
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                    console.log('Active candidate pair:', report);
                    if (report.remoteCandidateType === 'relay' || report.localCandidateType === 'relay') {
                        console.log('Connection is using a relay (TURN) server');
                    } else {
                        console.log('Connection is not using a relay');
                    }
                }
            });
        });
    }
}

// Call this function periodically
setInterval(checkConnectionStatus, 30000);
setInterval(checkRelayConnection, 30000);

