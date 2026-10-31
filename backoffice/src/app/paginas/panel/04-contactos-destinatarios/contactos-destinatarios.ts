import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactosDestinatariosApi, ContactoDestinatario } from '../../../servicios/contactos-destinatarios-api';

type VistaDestinatarios = 'listado' | 'nuevo' | 'ficha';

@Component({
    selector: 'app-contactos-destinatarios',
    imports: [ReactiveFormsModule],
    templateUrl: './contactos-destinatarios.html',
    styleUrl: './contactos-destinatarios.scss'
})
export class ContactosDestinatarios implements OnInit {

    private readonly api = inject(ContactosDestinatariosApi);
    private readonly fb = inject(FormBuilder);

    vistaActual = signal<VistaDestinatarios>('listado');

    contactos = signal<ContactoDestinatario[]>([]);
    contactoSeleccionado = signal<ContactoDestinatario | null>(null);

    cargando = signal(false);
    guardando = signal(false);
    datosConectados = signal(false);

    mensajeError = signal('');
    mensajeCorrecto = signal('');

    contactoParaEliminar = signal<ContactoDestinatario | null>(null);
    confirmarEliminarMensaje = signal(false);

    formularioContacto = this.fb.nonNullable.group({
        nombre: ['', [
            Validators.required,
            Validators.maxLength(100),
            Validators.pattern(/.*\S.*/)
        ]],
        correo: ['', [
            Validators.required,
            Validators.email,
            Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
        ]]
    });

    formularioMensaje = this.fb.nonNullable.group({
        contenido: ['']
    });

    ngOnInit(): void {
        void this.cargarContactos();
    }

    // Consultar la lista sin recuperar el contenido de las cartas
    async cargarContactos(): Promise<void> {
        this.cargando.set(true);
        this.mensajeError.set('');

        try {
            this.contactos.set(await this.api.obtenerContactos());
            this.datosConectados.set(true);
        } catch (error) {
            this.datosConectados.set(false);
            this.mostrarError(error);
        } finally {
            this.cargando.set(false);
        }
    }

    abrirNuevo(): void {
        this.limpiarMensajes();
        this.contactoSeleccionado.set(null);
        this.formularioContacto.reset();
        this.formularioMensaje.reset();
        this.vistaActual.set('nuevo');
    }

    // Abrir la ficha individual y consultar la carta privada
    async abrirFicha(contacto: ContactoDestinatario): Promise<void> {
        if (this.cargando()) return;

        this.limpiarMensajes();
        this.cargando.set(true);

        try {
            const ficha = await this.api.obtenerFicha(contacto.id);

            this.contactoSeleccionado.set(ficha);

            this.formularioContacto.setValue({
                nombre: ficha.nombre,
                correo: ficha.correo
            });

            this.formularioMensaje.setValue({
                contenido: ficha.mensaje ?? ''
            });

            this.vistaActual.set('ficha');

        } catch (error) {
            this.mostrarError(error);
        } finally {
            this.cargando.set(false);
        }
    }

    volverAlListado(): void {
        this.limpiarMensajes();
        this.contactoSeleccionado.set(null);
        this.vistaActual.set('listado');
        void this.cargarContactos();
    }

    // Crear o modificar los datos del destinatario
    async guardarContacto(): Promise<void> {
        if (this.guardando()) return;

        if (this.formularioContacto.invalid) {
            this.formularioContacto.markAllAsTouched();
            return;
        }

        const datos = this.formularioContacto.getRawValue();
        const nombre = datos.nombre.trim();
        const correo = datos.correo.trim().toLowerCase();

        if (!nombre) {
            this.formularioContacto.controls.nombre.setErrors({
                required: true
            });
            return;
        }

        this.guardando.set(true);
        this.limpiarMensajes();

        try {
            if (this.vistaActual() === 'nuevo') {
                const contacto = await this.api.crearContacto({
                    nombre,
                    correo
                });

                this.contactoSeleccionado.set(contacto);
                this.formularioMensaje.reset();
                this.vistaActual.set('ficha');

                this.mensajeCorrecto.set(
                    'El destinatario se ha añadido correctamente.'
                );

            } else {
                const contacto = this.contactoSeleccionado();

                if (!contacto) return;

                await this.api.actualizarContacto(
                    contacto.id,
                    { nombre, correo }
                );

                this.contactoSeleccionado.set({
                    ...contacto,
                    nombre,
                    correo
                });

                this.mensajeCorrecto.set(
                    'Los datos del destinatario se han guardado correctamente.'
                );
            }

        } catch (error) {
            this.mostrarError(error);
        } finally {
            this.guardando.set(false);
        }
    }

    // Guardar el mensaje privado como contenido de la carta
    async guardarMensaje(): Promise<void> {
        const contacto = this.contactoSeleccionado();

        if (!contacto || this.guardando()) return;

        const contenido =
            this.formularioMensaje.controls.contenido.value.trim();

        if (!contenido) {
            this.mensajeError.set(
                'Escribe un mensaje antes de guardarlo.'
            );
            return;
        }

        this.guardando.set(true);
        this.limpiarMensajes();

        try {
            await this.api.guardarMensaje(contacto.id, contenido);

            this.formularioMensaje.controls.contenido.setValue(
                contenido
            );

            this.contactoSeleccionado.set({
                ...contacto,
                tieneMensaje: true
            });

            this.mensajeCorrecto.set(
                'El mensaje personal se ha guardado correctamente.'
            );

        } catch (error) {
            this.mostrarError(error);
        } finally {
            this.guardando.set(false);
        }
    }

    // Eliminar exclusivamente el mensaje personal
    async eliminarMensaje(): Promise<void> {
        const contacto = this.contactoSeleccionado();

        if (!contacto || this.guardando()) return;

        this.guardando.set(true);
        this.mensajeError.set('');
        this.mensajeCorrecto.set('');

        try {
            await this.api.eliminarMensaje(contacto.id);

            this.formularioMensaje.reset();

            this.contactoSeleccionado.set({
                ...contacto,
                tieneMensaje: false
            });

            this.confirmarEliminarMensaje.set(false);

            this.mensajeCorrecto.set(
                'El mensaje personal se ha eliminado correctamente.'
            );

        } catch (error) {
            this.mostrarError(error);
        } finally {
            this.guardando.set(false);
        }
    }

    // Solicitar confirmación antes de eliminar un contacto
    solicitarEliminarContacto(contacto: ContactoDestinatario): void {
        this.limpiarMensajes();
        this.contactoParaEliminar.set(contacto);
    }

    cancelarEliminarContacto(): void {
        this.contactoParaEliminar.set(null);
    }

    // Eliminar el contacto y su mensaje asociado
    async eliminarContacto(): Promise<void> {
        const contacto = this.contactoParaEliminar();

        if (!contacto || this.guardando()) return;

        this.guardando.set(true);
        this.mensajeError.set('');
        this.mensajeCorrecto.set('');

        try {
            await this.api.eliminarContacto(contacto.id);

            this.contactoParaEliminar.set(null);
            this.contactoSeleccionado.set(null);
            this.vistaActual.set('listado');

            this.contactos.update(contactos =>
                contactos.filter(item => item.id !== contacto.id)
            );

            this.mensajeCorrecto.set(
                'El destinatario se ha eliminado correctamente.'
            );

        } catch (error) {
            this.mostrarError(error);
        } finally {
            this.guardando.set(false);
        }
    }

    private limpiarMensajes(): void {
        this.mensajeError.set('');
        this.mensajeCorrecto.set('');
        this.contactoParaEliminar.set(null);
        this.confirmarEliminarMensaje.set(false);
    }

    private mostrarError(error: unknown): void {
        this.mensajeError.set(
            error instanceof Error
                ? error.message
                : 'Se ha producido un error.'
        );
    }
}


