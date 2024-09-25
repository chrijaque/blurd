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
const maxReconnectAttempts = 5;
const reconnectInterval = 5000;
let heartbeatInterval;
let intentionalDisconnect = false; // Added flag to track intentional disconnects

// Landing Page Functions
async function setupLocalPreview() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localVideoPreview.srcObject = localStream;
        applyBlurEffectPreview();
    } catch (error) {
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
    setupLocalPreview();
    updateStartChatButton(); // Initial check
});

// Chat Initialization Functions
function initializeChat() {
    // Display the username if needed
    const username = localStorage.getItem('username');
    if (username) {
        console.log(`Welcome, ${username}!`);
    }

    // Set initial blur preference
    localWantsBlurOff = false; // Change this line to ensure blur is on by default

    // Initialize chat functionalities
    setupWebSocket();       // WebSocket setup before peer connection
    setupChat();
    setupBlurEffect();
    initializeConnection(); // Get local media stream
}

async function initializeConnection() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        // Do not call createPeerConnection() here
    } catch (error) {
        console.error('Error setting up local stream:', error);
    }
}

function createPeerConnection() {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
            }
        ],
        iceCandidatePoolSize: 10,
    };

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendMessage({ type: 'ice-candidate', candidate: event.candidate });
        }
    };

    peerConnection.ontrack = event => {
        if (event.track.kind === 'video') {
            const remoteVideo = document.getElementById('remoteVideo');
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                
                // Add this to ensure the video plays
                remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
            }
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        try {
            makingOffer = true;
            await peerConnection.setLocalDescription();
            sendMessage({ type: 'offer', offer: peerConnection.localDescription });
        } catch (err) {
            console.error('Error during negotiation:', err);
        } finally {
            makingOffer = false;
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'failed') {
            restartIce();
        } else if (peerConnection.iceConnectionState === 'connected') {
            checkRelayConnection();
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            setTimeout(restartIce, 2000);
        }
    };

    peerConnection.onconnectionstatechange = () => {
    };

    peerConnection.onicegatheringstatechange = () => {
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
}

function setupWebSocket() {
    socket = new WebSocket('wss://blurd.adaptable.app');

    socket.onopen = () => {
        console.log('WebSocket connected');
        socketReady = true;
        reconnectAttempts = 0;
        intentionalDisconnect = false; // Reset the flag on successful connection

        sendMessage({ type: 'ready' });
        // Start the heartbeat interval after the socket is open
        startHeartbeat();
    };

    socket.onclose = () => {
        console.log('WebSocket disconnected');
        socketReady = false;
        if (heartbeatInterval) clearInterval(heartbeatInterval);

        // Attempt to reconnect only if the disconnection was unintentional
        if (!intentionalDisconnect && reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
            reconnectAttempts++;
            setTimeout(setupWebSocket, reconnectInterval);
        } else {
            console.error('Max reconnect attempts reached or intentional disconnect. Please refresh the page.');
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

    if (data.type === 'pong') {
        // Connection is alive
        return;
    }

    switch (data.type) {
        case 'waiting':
            console.log('Waiting for peer...');
            isConnectedToPeer = false;
            if (statusMessage) {
                statusMessage.textContent = 'Waiting for a peer...';
            }
            break;
        case 'paired':
            console.log('Paired with a new peer');
            isConnectedToPeer = true;
            if (statusMessage) {
                statusMessage.textContent = 'Connected to a peer';
            }
            polite = !data.isOfferer; // Corrected assignment
            startConnection(data.isOfferer);
            clearChat();
            resetBlurState();
            break;
        case 'partnerDisconnected':
            console.log('Partner disconnected');
            if (statusMessage) {
                statusMessage.textContent = 'Partner disconnected';
            }
            handlePartnerDisconnect();
            break;
        case 'offer':
            handleOfferOrAnswer(new RTCSessionDescription(data.offer), true);
            break;
        case 'answer':
            handleOfferOrAnswer(new RTCSessionDescription(data.answer), false);
            break;
        case 'ice-candidate':
            handleIceCandidate(data.candidate);
            break;
        case 'chat':
            addMessageToChat(data.username, data.message);
            break;
        case 'audio-state':
            addMessageToChat('System', `Your partner has ${data.enabled ? 'enabled' : 'disabled'} their audio.`);
            break;
        case 'blur_state':
            console.log('Received blur state update:', data);
            remoteWantsBlurOff = data.wantsBlurOff;
            updateBlurState();
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

// Peer Connection and RTC Functions
function startConnection(isOfferer) {
    if (peerConnection) {
        console.log('Closing existing peer connection');
        peerConnection.close();
    }
    createPeerConnection();
    
    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // Log media streams after a short delay
    setTimeout(logMediaStreams, 2000);
}

async function handleOfferOrAnswer(description, isOffer) {
    const offerCollision = isOffer &&
                           (makingOffer || peerConnection.signalingState !== "stable");

    ignoreOffer = !polite && offerCollision;
    if (ignoreOffer) {
        console.log('Ignoring offer due to collision');
        return;
    }

    try {
        await peerConnection.setRemoteDescription(description);
        if (isOffer) {
            await peerConnection.setLocalDescription();
            sendMessage({ type: 'answer', answer: peerConnection.localDescription });
        }

        // Add queued ICE candidates after setting remote description
        while (iceCandidatesQueue.length) {
            const candidate = iceCandidatesQueue.shift();
            await peerConnection.addIceCandidate(candidate).catch(e => {
                console.error('Error adding queued ice candidate', e);
            });
        }
    } catch (err) {
        console.error('Error handling offer or answer:', err);
    }
}

function handleIceCandidate(candidate) {
    console.log('Handling ICE candidate:', JSON.stringify(candidate));
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        peerConnection.addIceCandidate(candidate)
            .then(() => console.log('ICE candidate added successfully'))
            .catch(e => console.error('Error adding received ice candidate', e));
    } else {
        iceCandidatesQueue.push(candidate);
    }
}

function setupDataChannel() {
    if (peerConnection.createDataChannel) {
        dataChannel = peerConnection.createDataChannel('chat');
        dataChannel.onmessage = handleDataChannelMessage;
    } else {
        console.error('Data channels are not supported');
    }
}

function handleDataChannelMessage(event) {
    const message = JSON.parse(event.data);
    if (message.type === 'blurState') {
        remoteWantsBlurOff = message.blurState;
        updateBlurState();
    }
}

// Chat Functions
function setupChat() {

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
    const removeBlurButton = document.getElementById('removeBlurButton');

    if (!localVideo || !remoteVideo || !removeBlurButton) {
        console.error('Video elements or remove blur button not found');
        return;
    }

    console.log('Updating blur state:', { localWantsBlurOff, remoteWantsBlurOff });

    if (localWantsBlurOff && remoteWantsBlurOff) {
        // Both want to remove blur
        localVideo.style.filter = 'none';
        remoteVideo.style.filter = 'none';
        removeBlurButton.textContent = 'Blur Removed';
        removeBlurButton.style.backgroundColor = 'blue';
        removeBlurButton.style.color = 'white';
        removeBlurButton.disabled = true;
    } else if (localWantsBlurOff && !remoteWantsBlurOff) {
        // You want to remove blur; waiting for partner
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Waiting for partner';
        removeBlurButton.disabled = true;
        addMessageToChat('System', "Waiting for your partner to accept removing the blur.");
    } else if (!localWantsBlurOff && remoteWantsBlurOff) {
        // Partner wants to remove blur; ask for confirmation
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Accept Remove Blur';
        removeBlurButton.disabled = false;
        addMessageToChat('System', "Your partner wants to remove blur. Click 'Accept Remove Blur' to agree.");
    } else {
        // Both want blur on
        localVideo.style.filter = 'blur(10px)';
        remoteVideo.style.filter = 'blur(10px)';
        removeBlurButton.textContent = 'Remove Blur';
        removeBlurButton.disabled = false;
    }

    console.log('Blur state updated');
}

function toggleBlur() {
    localWantsBlurOff = !localWantsBlurOff;
    sendBlurState();
    updateBlurState();
}

function sendBlurState() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const message = {
            type: 'blur_state',
            wantsBlurOff: localWantsBlurOff
        };
        socket.send(JSON.stringify(message));
        console.log('Sent blur state:', message);
    } else {
        console.error('WebSocket is not open. Cannot send blur state.');
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
}

function restartIce() {
    if (peerConnection) {
        peerConnection.restartIce();
        peerConnection.createOffer({ iceRestart: true })
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                sendMessage({ type: 'offer', offer: peerConnection.localDescription });
            })
            .catch(error => console.error('Error during ICE restart:', error));
    }
}


function forceRelayICECandidates() {
    if (peerConnection) {
        peerConnection.getTransceivers().forEach(transceiver => {
            transceiver.sender.setParameters({
                ...transceiver.sender.getParameters(),
                encodings: [{ networkPriority: 'low' }]
            });
        });
    }
}

function checkRelayConnection() {
    if (peerConnection) {
        peerConnection.getStats(null).then(stats => {
        });
    }
}

// Call this function periodically
setInterval(checkConnectionStatus, 30000);
setInterval(checkRelayConnection, 30000);
