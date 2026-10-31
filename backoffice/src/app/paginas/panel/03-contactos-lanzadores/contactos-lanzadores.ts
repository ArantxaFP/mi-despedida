import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../../servicios/autenticacion';
import { ContactosLanzadoresApi } from '../../../servicios/contactos-lanzadores-api';


type VistaLanzadores = 'listado' | 'invitar' | 'revisar' | 'revocar';

type EstadoAsignacion =
    | 'pendiente'
    | 'aceptada'
    | 'rechazada'
    | 'caducada'
    | 'revocada'
    | 'renunciada'
    | 'inhabilitada';

interface AsignacionLanzador {
    id: string;
    nombre: string;
    correo: string;
    estado: EstadoAsignacion;
    habilitada: boolean;
}

@Component({
    selector: 'app-contactos-lanzadores',
    imports: [ReactiveFormsModule],
    templateUrl: './contactos-lanzadores.html',
    styleUrl: './contactos-lanzadores.scss'
})
export class ContactosLanzadores implements OnInit {

    private autenticacion = inject(Autenticacion);
    private constructorFormulario = inject(FormBuilder);

    private contactosLanzadoresApi =
        inject(ContactosLanzadoresApi);

    cargandoLanzadores = signal(false);
    enviandoInvitacion = signal(false);
    mensajeCorrecto = signal('');


    vistaActual = signal<VistaLanzadores>('listado');

    lanzadores = signal<AsignacionLanzador[]>([]);
    datosConectados = signal(false);

    correoTitular = signal('');
    comprobandoTitular = signal(true);

    mensajeError = signal('');

    lanzadorSeleccionado = signal<AsignacionLanzador | null>(null);

    formularioInvitacion = this.constructorFormulario.nonNullable.group({
        nombre: ['', [
            Validators.required,
            Validators.maxLength(100)
        ]],
        correo: ['', [
            Validators.required,
            Validators.email,
            Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
        ]]
    });

    lanzadoresHabilitados = computed(() =>
        this.lanzadores().filter(
            lanzador => lanzador.estado === 'aceptada' &&
                lanzador.habilitada
        ).length
    );

    invitacionesPendientes = computed(() =>
        this.lanzadores().filter(
            lanzador => lanzador.estado === 'pendiente'
        ).length
    );

    minimoCumplido = computed(() =>
        this.lanzadoresHabilitados() >= 2
    );

    habilitadosTrasRevocar = computed(() => {
        const seleccionado = this.lanzadorSeleccionado();

        if (!seleccionado) {
            return this.lanzadoresHabilitados();
        }

        const cuentaActualmente =
            seleccionado.estado === 'aceptada' &&
            seleccionado.habilitada;

        return Math.max(
            0,
            this.lanzadoresHabilitados() - (cuentaActualmente ? 1 : 0)
        );
    });


    ngOnInit(): void {
        void this.cargarTitular();
        void this.cargarLanzadores();
    }


    async cargarTitular(): Promise<void> {
        this.comprobandoTitular.set(true);

        try {
            const { data, error } =
                await this.autenticacion.obtenerUsuario();

            if (error || !data.user?.email) {
                this.mensajeError.set(
                    'No se ha podido comprobar la identidad del titular.'
                );
                return;
            }

            this.correoTitular.set(
                data.user.email.trim().toLowerCase()
            );

        } catch {
            this.mensajeError.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.comprobandoTitular.set(false);
        }
    }

    abrirInvitacion(): void {
        this.formularioInvitacion.reset();
        this.mensajeError.set('');
        this.vistaActual.set('invitar');
    }

    revisarInvitacion(): void {
        this.mensajeError.set('');

        if (this.comprobandoTitular() || !this.correoTitular()) {
            this.mensajeError.set(
                'No se ha podido verificar el correo de tu cuenta.'
            );
            return;
        }

        if (this.formularioInvitacion.invalid) {
            this.formularioInvitacion.markAllAsTouched();
            return;
        }

        const datos = this.formularioInvitacion.getRawValue();
        const nombre = datos.nombre.trim();
        const correo = datos.correo.trim().toLowerCase();

        if (!nombre) {
            this.formularioInvitacion.controls.nombre.setErrors({
                required: true
            });
            return;
        }

        if (correo === this.correoTitular()) {
            this.mensajeError.set(
                'No puedes ser lanzador de tu propia cuenta.'
            );
            this.vistaActual.set('revisar');
            return;
        }

        const existeAsignacionVigente = this.lanzadores().some(
            lanzador =>
                lanzador.correo.trim().toLowerCase() === correo &&
                ['pendiente', 'aceptada'].includes(lanzador.estado)
        );

        if (existeAsignacionVigente) {
            this.mensajeError.set(
                'Este correo ya tiene una invitación o autorización vigente. ' +
                'Revisa su estado en el listado.'
            );
            this.vistaActual.set('revisar');
            return;
        }

        this.formularioInvitacion.patchValue({
            nombre,
            correo
        });

        this.vistaActual.set('revisar');
    }

    abrirRevocacion(lanzador: AsignacionLanzador): void {
        if (lanzador.estado !== 'aceptada' || !lanzador.habilitada) {
            return;
        }

        this.lanzadorSeleccionado.set(lanzador);
        this.mensajeError.set('');
        this.vistaActual.set('revocar');
    }

    volverAlListado(): void {
        this.mensajeError.set('');
        this.lanzadorSeleccionado.set(null);
        this.vistaActual.set('listado');
    }

    volverAInvitacion(): void {
        this.mensajeError.set('');
        this.vistaActual.set('invitar');
    }

    nombreEstado(estado: EstadoAsignacion): string {
        const nombres: Record<EstadoAsignacion, string> = {
            pendiente: 'Pendiente',
            aceptada: 'Aceptada',
            rechazada: 'Rechazada',
            caducada: 'Caducada',
            revocada: 'Revocada',
            renunciada: 'Renunciada',
            inhabilitada: 'Inhabilitada'
        };

        return nombres[estado];
    }


    // Consultar las asignaciones reales del administrador
    async cargarLanzadores(): Promise<void> {
        this.cargandoLanzadores.set(true);
        this.mensajeError.set('');

        try {
            const asignaciones =
                await this.contactosLanzadoresApi.obtenerAsignaciones();

            this.lanzadores.set(
                asignaciones.map(asignacion => ({
                    id: asignacion.id,
                    nombre: asignacion.lanzadores.nombre,
                    correo: asignacion.lanzadores.correo,
                    estado: asignacion.estado,
                    habilitada: asignacion.estado === 'aceptada'
                }))
            );

            this.datosConectados.set(true);

        } catch (error) {
            this.datosConectados.set(false);

            this.mensajeError.set(
                error instanceof Error
                    ? error.message
                    : 'No se han podido cargar los lanzadores.'
            );

        } finally {
            this.cargandoLanzadores.set(false);
        }
    }


    // Solicitar el envío de la invitación desde Nest
    async enviarInvitacion(): Promise<void> {
        if (this.enviandoInvitacion()) {
            return;
        }

        this.enviandoInvitacion.set(true);
        this.mensajeError.set('');
        this.mensajeCorrecto.set('');

        try {
            const datos = this.formularioInvitacion.getRawValue();

            await this.contactosLanzadoresApi.crearInvitacion({
                nombre: datos.nombre.trim(),
                correo: datos.correo.trim().toLowerCase()
            });

            await this.cargarLanzadores();

            this.formularioInvitacion.reset();
            this.vistaActual.set('listado');

            this.mensajeCorrecto.set(
                'Brevo ha aceptado la solicitud de envío de la invitación.'
            );

        } catch (error) {
            this.mensajeError.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido enviar la invitación.'
            );

        } finally {
            this.enviandoInvitacion.set(false);
        }
    }


}
