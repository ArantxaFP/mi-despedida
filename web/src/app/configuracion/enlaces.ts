const esLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

const urlBackoffice = esLocal
    ? 'http://localhost:4200'
    : 'https://gestion-mi-despedida.netlify.app';

export const enlaces = {

    // BACKOFFICE
    acceso: `${urlBackoffice}/acceso`,
    registro: `${urlBackoffice}/registro`,

    // ACCESO PARA LANZADORES
    accesoLanzador: `${urlBackoffice}/acceso`,

    // WEB COMERCIAL
    politicaPrivacidad: '/politica-de-privacidad',
    preguntasFrecuentes: '/faq',
    contacto: '/contacto'

};
