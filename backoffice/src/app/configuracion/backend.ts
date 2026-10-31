export const configuracionBackend = {
    url: window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://mi-despedida-backend.onrender.com'
};

