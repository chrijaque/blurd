let localStream;
let isBlurred = true;

const localVideo = document.getElementById('localVideoPreview');
const toggleBlurButton = document.getElementById('toggleBlurButton');
const usernameInput = document.getElementById('usernameInput');
const termsCheckbox = document.getElementById('termsCheckbox');
const startChatButton = document.getElementById('startChatButton');

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        localVideo.srcObject = localStream;
        applyBlurEffect();
        console.log('Camera accessed successfully');
    } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Unable to access camera. Please ensure you have given permission and try again.');
    }
}

function applyBlurEffect() {
    localVideo.style.filter = isBlurred ? 'blur(10px)' : 'none';
}

toggleBlurButton.addEventListener('click', () => {
    isBlurred = !isBlurred;
    applyBlurEffect();
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
        window.location.href = 'index.html';
    }
});

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    setupLocalStream();
    updateStartChatButton(); // Initial check
});

// Add these lines for debugging
usernameInput.addEventListener('input', () => console.log('Username input changed:', usernameInput.value));
termsCheckbox.addEventListener('change', () => console.log('Checkbox changed:', termsCheckbox.checked));