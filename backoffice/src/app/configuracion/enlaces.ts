const esLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

const urlWebComercial = esLocal
    ? 'http://localhost:4201'
    : 'https://mi-despedida.netlify.app';

export const enlaces = {
    webComercial: urlWebComercial,
    politicaPrivacidad: `${urlWebComercial}/politica-de-privacidad`
};
