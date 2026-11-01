import { Routes } from '@angular/router';

export const routes: Routes = [

    // 01 - HOME
    {
        path: '',
        title: 'Mi Despedida | Inicio',
        loadComponent: () =>
            import('./paginas/01home/home')
                .then(m => m.Home)
    },

    // 02 - INFORMACIÓN PARA LANZADORES
    {
        path: 'lanzadores',
        title: 'Mi Despedida | Información para lanzadores',
        loadComponent: () =>
            import('./paginas/02info_lanzadores/info-lanzadores')
                .then(m => m.InfoLanzadores)
    },

    // 03 - PREGUNTAS FRECUENTES
    {
        path: 'faq',
        title: 'Mi Despedida | Preguntas frecuentes',
        loadComponent: () =>
            import('./paginas/03FAQs/faqs')
                .then(m => m.Faqs)
    },

    // 04 - CONTACTO
    {
        path: 'contacto',
        title: 'Mi Despedida | Contacto',
        loadComponent: () =>
            import('./paginas/04contacto/contacto')
                .then(m => m.Contacto)
    },

    // 05 - POLÍTICA DE PRIVACIDAD
    {
        path: 'politica-de-privacidad',
        title: 'Mi Despedida | Política de privacidad',
        loadComponent: () =>
            import('./paginas/05politica_privacidad/politica-privacidad')
                .then(m => m.PoliticaPrivacidad)
    },

    // RUTAS NO ENCONTRADAS
    {
        path: '**',
        redirectTo: ''
    }

];
