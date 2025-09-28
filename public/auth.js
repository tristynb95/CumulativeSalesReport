document.addEventListener('DOMContentLoaded', () => {
    // --- FIREBASE INITIALIZATION ---
    // Firebase is now initialized automatically by the /__/firebase/init.js script
    const auth = firebase.auth();

    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const authError = document.getElementById('auth-error');

    // Redirect if user is already logged in
    auth.onAuthStateChanged(user => {
        if (user) {
            window.location.href = '/index.html';
        }
    });

    const handleError = (error) => {
        authError.textContent = error.message;
    };

    loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const email = emailInput.value;
        const password = passwordInput.value;
        auth.signInWithEmailAndPassword(email, password).catch(handleError);
    });

    signupBtn.addEventListener('click', () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        auth.createUserWithEmailAndPassword(email, password).catch(handleError);
    });
});
