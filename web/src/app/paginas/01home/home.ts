import { Component, ElementRef, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { enlaces } from '../../configuracion/enlaces';

interface Captura {
    src: string;
    alt: string;
    titulo: string;
}

@Component({
    selector: 'app-home',
    imports: [RouterLink],
    templateUrl: './home.html',
    styleUrl: './home.scss'
})
export class Home {

    // Acceso a la aplicación de gestión
    readonly enlaces = enlaces;

    readonly capturasDesktop: Captura[] = [
        {
            src: '/imagenes/panel_desktop/dashboard.png',
            titulo: 'Tu espacio personal',
            alt: 'Dashboard de Mi Despedida en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/perfil.png',
            titulo: 'Gestión del perfil',
            alt: 'Formulario de datos personales en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/lanzadores.png',
            titulo: 'Contactos lanzadores',
            alt: 'Listado de autorizaciones de lanzadores en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/destinatarios.png',
            titulo: 'Contactos destinatarios',
            alt: 'Tabla de destinatarios de Mi Despedida en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/carta.png',
            titulo: 'Mensajes personales',
            alt: 'Editor de una carta personal en escritorio'
        }
    ];

    readonly capturasMobile: Captura[] = [
        {
            src: '/imagenes/panel_mobile/dashboard.png',
            titulo: 'Tu espacio desde el móvil',
            alt: 'Dashboard de Mi Despedida en móvil'
        },
        {
            src: '/imagenes/panel_mobile/perfil.png',
            titulo: 'Tu perfil',
            alt: 'Vista móvil del perfil'
        },
        {
            src: '/imagenes/panel_mobile/lanzadores.png',
            titulo: 'Tus lanzadores',
            alt: 'Vista móvil de contactos lanzadores'
        },
        {
            src: '/imagenes/panel_mobile/destinatarios.png',
            titulo: 'Tus destinatarios',
            alt: 'Vista móvil de los contactos destinatarios'
        },
        {
            src: '/imagenes/panel_mobile/carta.png',
            titulo: 'Tu mensaje personal',
            alt: 'Vista móvil del editor de cartas'
        }
    ];

    @ViewChild('carruselDesktop')
    private carruselDesktop?: ElementRef<HTMLElement>;

    @ViewChild('carruselMobile')
    private carruselMobile?: ElementRef<HTMLElement>;

    moverDesktop(direccion: -1 | 1): void {
        this.desplazar(
            this.carruselDesktop?.nativeElement,
            direccion
        );
    }

    moverMobile(direccion: -1 | 1): void {
        this.desplazar(
            this.carruselMobile?.nativeElement,
            direccion
        );
    }

    private desplazar(
        carrusel: HTMLElement | undefined,
        direccion: -1 | 1
    ): void {
        if (!carrusel) return;

        const tarjeta = carrusel.querySelector<HTMLElement>(
            '.home__captura'
        );

        const anchoTarjeta =
            tarjeta?.getBoundingClientRect().width ??
            carrusel.clientWidth;

        const estilos = getComputedStyle(carrusel);
        const separacion = parseFloat(estilos.columnGap) || 0;

        carrusel.scrollBy({
            left: (anchoTarjeta + separacion) * direccion,
            behavior: window.matchMedia(
                '(prefers-reduced-motion: reduce)'
            ).matches ? 'instant' : 'smooth'
        });
    }
}
