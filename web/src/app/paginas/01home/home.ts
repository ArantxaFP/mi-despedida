import { Component, ElementRef, ViewChild, HostListener } from '@angular/core';
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

    // VISOR DE CAPTURAS A PANTALLA COMPLETA
    @ViewChild('dialogoCapturas')
    private dialogoCapturas?: ElementRef<HTMLDialogElement>;

    tipoGaleria: 'desktop' | 'mobile' = 'desktop';
    indiceCaptura = 0;

    get capturasVisor(): Captura[] {
        return this.tipoGaleria === 'desktop'
            ? this.capturasDesktop
            : this.capturasMobile;
    }

    get capturaActual(): Captura | undefined {
        return this.capturasVisor[this.indiceCaptura];
    }

    abrirVisor(
        tipo: 'desktop' | 'mobile',
        indice: number
    ): void {
        this.tipoGaleria = tipo;
        this.indiceCaptura = indice;
        this.dialogoCapturas?.nativeElement.showModal();
    }

    cerrarVisor(): void {
        this.dialogoCapturas?.nativeElement.close();
    }

    cambiarCaptura(direccion: -1 | 1): void {
        const total = this.capturasVisor.length;

        if (total === 0) return;

        this.indiceCaptura =
            (this.indiceCaptura + direccion + total) % total;
    }

    @HostListener('window:keydown', ['$event'])
    controlarTeclado(evento: KeyboardEvent): void {
        if (!this.dialogoCapturas?.nativeElement.open) return;

        if (evento.key === 'ArrowLeft') {
            evento.preventDefault();
            this.cambiarCaptura(-1);
        }

        if (evento.key === 'ArrowRight') {
            evento.preventDefault();
            this.cambiarCaptura(1);
        }
    }



    readonly capturasDesktop: Captura[] = [
        {
            src: '/imagenes/panel_desktop/01bo_crear_cuenta_desktop.webp',
            titulo: 'Crear una cuenta',
            alt: 'Formulario de registro de Mi Despedida en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/02bo_acceso_cuenta_desktop.webp',
            titulo: 'Iniciar sesión',
            alt: 'Pantalla de acceso a Mi Despedida en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/03bo_recuperar_contrasena_desktop.webp',
            titulo: 'Recuperar contraseña',
            alt: 'Formulario para recuperar la contraseña en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/04bo_acceso_lanzador_desktop.webp',
            titulo: 'Acceso como lanzador',
            alt: 'Pantalla de acceso de lanzadores en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/05bo_dashboard_desktop.webp',
            titulo: 'Tu espacio personal',
            alt: 'Dashboard de Mi Despedida en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/06bo_perfil_desktop.webp',
            titulo: 'Gestión del perfil',
            alt: 'Pantalla del perfil de administrador en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/07bo_lanzadores_desktop.webp',
            titulo: 'Contactos lanzadores',
            alt: 'Gestión de contactos lanzadores en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/08bo_destinatarios_desktop.webp',
            titulo: 'Contactos destinatarios',
            alt: 'Gestión de contactos destinatarios en escritorio'
        },
        {
            src: '/imagenes/panel_desktop/09bo_destinatario_edicion_desktop.webp',
            titulo: 'Edición de destinatarios',
            alt: 'Formulario de edición de un contacto destinatario en escritorio'
        }
    ];


    readonly capturasMobile: Captura[] = [
        {
            src: '/imagenes/panel_mobile/01bo_crear_cuenta_mobile.webp',
            titulo: 'Crear una cuenta',
            alt: 'Formulario de registro de Mi Despedida en móvil'
        },
        {
            src: '/imagenes/panel_mobile/02bo_acceso_cuenta_mobile.webp',
            titulo: 'Iniciar sesión',
            alt: 'Pantalla de acceso a Mi Despedida en móvil'
        },
        {
            src: '/imagenes/panel_mobile/03bo_recuperar_contrasena_mobile.webp',
            titulo: 'Recuperar contraseña',
            alt: 'Formulario para recuperar la contraseña en móvil'
        },
        {
            src: '/imagenes/panel_mobile/04bo_acceso_lanzador_mobile.webp',
            titulo: 'Acceso como lanzador',
            alt: 'Pantalla de acceso de lanzadores en móvil'
        },
        {
            src: '/imagenes/panel_mobile/05bo_dashboard_mobile.webp',
            titulo: 'Tu espacio desde el móvil',
            alt: 'Dashboard de Mi Despedida en móvil'
        },
        {
            src: '/imagenes/panel_mobile/06bo_perfil_mobile.webp',
            titulo: 'Tu perfil',
            alt: 'Vista móvil del perfil del administrador'
        },
        {
            src: '/imagenes/panel_mobile/07bo_lanzadores_mobile.webp',
            titulo: 'Tus lanzadores',
            alt: 'Vista móvil de los contactos lanzadores'
        },
        {
            src: '/imagenes/panel_mobile/08bo_destinatarios_mobile.webp',
            titulo: 'Tus destinatarios',
            alt: 'Vista móvil de los contactos destinatarios'
        },
        {
            src: '/imagenes/panel_mobile/09bo_destinatario_edicion_mobile.webp',
            titulo: 'Edición de destinatarios',
            alt: 'Vista móvil del formulario de edición de destinatarios'
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
