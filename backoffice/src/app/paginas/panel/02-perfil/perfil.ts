import { Component, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion, type BloqueoEdicionCuenta } from '../../../servicios/autenticacion';

type VistaPerfil = 'datos' | 'correo' | 'contrasena' | 'baja';

@Component({
    selector: 'app-perfil',
    imports: [ReactiveFormsModule],
    templateUrl: './perfil.html',
    styleUrl: './perfil.scss'
})
export class Perfil implements OnInit, OnDestroy {
    private autenticacion = inject(Autenticacion);
    private constructorFormulario = inject(FormBuilder);

    vistaActual = signal<VistaPerfil>('datos');
    cargando = signal(true);
    guardando = signal(false);

    // Indica si el administrador está editando sus datos personales
    editandoDatos = signal(false);

    readonly solicitandoBloqueo = signal(false);

    // Activar en la base de pruebas cuando el SQL y la renovación estén preparados
    private readonly usarBloqueoPerfil = false;
    private bloqueoPerfil: BloqueoEdicionCuenta | null = null;
    private temporizadorRenovacion: number | undefined;
    private perfilDestruido = false;

    // Conserva los últimos datos cargados o guardados para poder cancelar una edición
    private datosGuardados = {
        nombre: '',
        apellidos: ''
    };


    mensaje = signal('');
    error = signal('');

    correoActual = signal('');
    correoVerificado = signal(false);

    mostrarContrasena = signal(false);
    mostrarConfirmacion = signal(false);

    formularioDatos = this.constructorFormulario.nonNullable.group({
        nombre: ['', [
            Validators.required,
            Validators.maxLength(100)
        ]],
        apellidos: ['', [
            Validators.maxLength(150)
        ]]
    });

    formularioCorreo = this.constructorFormulario.nonNullable.group({
        nuevoCorreo: ['', [
            Validators.required,
            Validators.email,
            Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
        ]]
    });

    formularioContrasena = this.constructorFormulario.nonNullable.group({
        contrasena: ['', [
            Validators.required,
            Validators.minLength(10),
            Validators.pattern(
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/
            )
        ]],
        confirmarContrasena: ['', [
            Validators.required
        ]]
    });

    formularioBaja = this.constructorFormulario.nonNullable.group({
        confirmacion: [false, [
            Validators.requiredTrue
        ]]
    });

    ngOnInit(): void {
        void this.cargarPerfil();
    }

    async cargarPerfil(): Promise<void> {
        this.cargando.set(true);
        this.error.set('');

        try {
            const { data, error } = await this.autenticacion.obtenerUsuario();

            if (error || !data.user) {
                this.error.set(
                    'No se han podido recuperar los datos de tu cuenta.'
                );
                return;
            }

            const usuario = data.user;

            const datosPerfil = await this.autenticacion.obtenerDatosPerfil();

            this.datosGuardados = {
                nombre: datosPerfil.nombre,
                apellidos: datosPerfil.apellidos ?? ''
            };

            this.formularioDatos.patchValue(this.datosGuardados);

            this.correoActual.set(usuario.email ?? '');
            this.correoVerificado.set(
                Boolean(usuario.email_confirmed_at)
            );

        } catch {
            this.error.set(
                'No se han podido recuperar los datos de tu cuenta.'
            );
        } finally {
            this.cargando.set(false);
        }
    }

    cambiarVista(vista: VistaPerfil): void {
        if (this.usarBloqueoPerfil) {
            if (this.solicitandoBloqueo() || this.guardando()) {
                return;
            }

            if (vista !== 'datos' && this.editandoDatos()) {
                this.cancelarEdicionDatos();
            }
        }

        this.vistaActual.set(vista);
        this.mensaje.set('');
        this.error.set('');

        this.formularioCorreo.reset();
        this.formularioContrasena.reset();
        this.formularioBaja.reset();

        this.mostrarContrasena.set(false);
        this.mostrarConfirmacion.set(false);
    }


    // Preparar la edición de los datos personales
    async iniciarEdicionDatos(): Promise<void> {
        if (
            this.cargando() ||
            this.guardando() ||
            this.editandoDatos() ||
            this.solicitandoBloqueo()
        ) {
            return;
        }

        this.mensaje.set('');
        this.error.set('');

        if (!this.usarBloqueoPerfil) {
            this.editandoDatos.set(true);
            return;
        }

        this.solicitandoBloqueo.set(true);

        try {
            const { bloqueo, error } =
                await this.autenticacion.adquirirBloqueoPerfil();

            if (this.perfilDestruido) {
                if (bloqueo) {
                    void this.autenticacion.liberarBloqueoPerfil(bloqueo.token);
                }
                return;
            }

            if (error || !bloqueo) {
                this.error.set(
                    error?.message ?? 'No se ha podido iniciar la edición del perfil.'
                );
                return;
            }

            this.bloqueoPerfil = bloqueo;
            this.datosGuardados = {
                nombre: bloqueo.datosActuales.nombre,
                apellidos: bloqueo.datosActuales.apellidos ?? ''
            };

            this.formularioDatos.reset(this.datosGuardados);
            this.programarRenovacionBloqueo();
            this.editandoDatos.set(true);
        } finally {
            this.solicitandoBloqueo.set(false);
        }
    }

    // Cancelar los cambios sin modificar los datos guardados
    cancelarEdicionDatos(): void {
        if (this.guardando()) {
            return;
        }

        this.liberarBloqueoDatos();
        this.formularioDatos.reset(this.datosGuardados);

        this.editandoDatos.set(false);
        this.mensaje.set('');
        this.error.set('');
    }

    private programarRenovacionBloqueo(espera = 120_000): void {
        this.detenerRenovacionBloqueo();

        this.temporizadorRenovacion = window.setTimeout(() => {
            this.temporizadorRenovacion = undefined;
            void this.renovarBloqueoDatos();
        }, espera);
    }

    private detenerRenovacionBloqueo(): void {
        if (this.temporizadorRenovacion !== undefined) {
            window.clearTimeout(this.temporizadorRenovacion);
            this.temporizadorRenovacion = undefined;
        }
    }

    private async renovarBloqueoDatos(): Promise<void> {
        const bloqueo = this.bloqueoPerfil;

        if (!bloqueo || this.perfilDestruido) {
            return;
        }

        if (this.guardando()) {
            this.programarRenovacionBloqueo(5_000);
            return;
        }

        const { fechaCaducidad, conflicto } =
            await this.autenticacion.renovarBloqueoPerfil(bloqueo.token);

        // Ignorar la respuesta si el usuario canceló, guardó o salió del perfil
        if (this.perfilDestruido || this.bloqueoPerfil?.token !== bloqueo.token) {
            return;
        }

        if (this.guardando()) {
            this.programarRenovacionBloqueo(5_000);
            return;
        }

        if (conflicto) {
            this.bloqueoPerfil = null;
            this.error.set(
                'La edición ha perdido su bloqueo. ' +
                'Copia tus cambios antes de cancelar y volver a pulsar Editar o lo perderás.'
            );
            return;
        }

        if (!fechaCaducidad) {
            this.programarRenovacionBloqueo(15_000);
            return;
        }

        this.bloqueoPerfil = { ...bloqueo, fechaCaducidad };
        this.programarRenovacionBloqueo();
    }


    private liberarBloqueoDatos(): void {
        this.detenerRenovacionBloqueo();

        const bloqueo = this.bloqueoPerfil;
        this.bloqueoPerfil = null;

        if (bloqueo) {
            void this.autenticacion.liberarBloqueoPerfil(bloqueo.token);
        }
    }

    ngOnDestroy(): void {
        this.perfilDestruido = true;

        this.detenerRenovacionBloqueo();

        if (!this.guardando()) {
            this.liberarBloqueoDatos();
        }
    }

    async guardarDatos(): Promise<void> {
        this.mensaje.set('');
        this.error.set('');

        if (this.guardando() || !this.editandoDatos()) return;

        if (this.formularioDatos.invalid) {
            this.formularioDatos.markAllAsTouched();
            return;
        }

        const datos = this.formularioDatos.getRawValue();
        const nombre = datos.nombre.trim();
        const apellidos = datos.apellidos.trim();

        if (!nombre) {
            this.formularioDatos.controls.nombre.setErrors({
                required: true
            });
            return;
        }

        this.guardando.set(true);

        try {

            let mensajeGuardado = 'Tus datos personales se han actualizado correctamente.';

            if (this.usarBloqueoPerfil) {
                const bloqueo = this.bloqueoPerfil;

                if (!bloqueo) {
                    this.error.set(
                        'La edición ya no tiene un bloqueo válido. ' +
                        'Copia tus cambios antes de cancelar y volver a pulsar Editar.'
                    );
                    return;
                }

                const { resultado, error, conflicto } =
                    await this.autenticacion.actualizarDatosPerfilBloqueo(
                        nombre,
                        apellidos,
                        bloqueo
                    );

                if (error || !resultado) {
                    if (conflicto) {
                        this.liberarBloqueoDatos();
                    }

                    this.error.set(
                        conflicto
                            ? 'La edición ha caducado o el perfil ha cambiado. ' +
                            'Copia tus cambios antes de cancelar y volver a pulsar Editar.'
                            : error?.message ?? 'No se han podido guardar estos datos.'
                    );
                    return;
                }

                // Nest ya ha liberado el bloqueo, también si los datos coincidían
                this.detenerRenovacionBloqueo();
                this.bloqueoPerfil = null;
                mensajeGuardado = resultado.mensaje;
            } else {
                const { error } = await this.autenticacion.actualizarDatosPersonales(
                    nombre,
                    apellidos
                );

                if (error) {
                    this.error.set(
                        'No se han podido guardar estos datos. Inténtalo de nuevo.'
                    );
                    return;
                }
            }


            this.formularioDatos.patchValue({
                nombre,
                apellidos
            });

            // Actualizar la copia de los datos guardados
            this.datosGuardados = {
                nombre,
                apellidos
            };

            this.editandoDatos.set(false);

            this.mensaje.set(mensajeGuardado);

        } catch {
            this.error.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.guardando.set(false);

            if (this.perfilDestruido) {
                this.liberarBloqueoDatos();
            }
        }


    }

    async solicitarCambioCorreo(): Promise<void> {
        this.mensaje.set('');
        this.error.set('');

        if (this.guardando()) return;

        if (this.formularioCorreo.invalid) {
            this.formularioCorreo.markAllAsTouched();
            return;
        }

        const nuevoCorreo = this.formularioCorreo
            .getRawValue()
            .nuevoCorreo.trim()
            .toLowerCase();

        if (nuevoCorreo === this.correoActual().toLowerCase()) {
            this.error.set(
                'El nuevo correo es igual al correo actual.'
            );
            return;
        }

        this.guardando.set(true);

        try {
            const { error } =
                await this.autenticacion.cambiarCorreo(nuevoCorreo);

            if (error) {
                this.error.set(
                    'No se ha podido solicitar el cambio de correo. ' +
                    'Comprueba la dirección e inténtalo de nuevo.'
                );
                return;
            }

            this.formularioCorreo.reset();

            this.mensaje.set(
                'Solicitud enviada. Revisa los correos de verificación ' +
                'y sigue las instrucciones para confirmar el cambio.'
            );

        } catch {
            this.error.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.guardando.set(false);
        }
    }

    cambiarVisibilidadContrasena(): void {
        this.mostrarContrasena.update(valor => !valor);
    }

    cambiarVisibilidadConfirmacion(): void {
        this.mostrarConfirmacion.update(valor => !valor);
    }

    async guardarContrasena(): Promise<void> {
        this.mensaje.set('');
        this.error.set('');

        if (this.guardando()) return;

        if (this.formularioContrasena.invalid) {
            this.formularioContrasena.markAllAsTouched();
            return;
        }

        const datos = this.formularioContrasena.getRawValue();

        if (datos.contrasena !== datos.confirmarContrasena) {
            this.error.set('Las contraseñas no coinciden.');
            return;
        }

        this.guardando.set(true);

        try {
            const { error } =
                await this.autenticacion.cambiarContrasena(
                    datos.contrasena
                );

            if (error) {
                this.error.set(
                    'No se ha podido cambiar la contraseña. ' +
                    'Puede ser necesario verificar de nuevo tu identidad.'
                );
                return;
            }

            this.formularioContrasena.reset();
            this.mostrarContrasena.set(false);
            this.mostrarConfirmacion.set(false);

            this.mensaje.set(
                'Tu contraseña se ha cambiado correctamente.'
            );

        } catch {
            this.error.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.guardando.set(false);
        }
    }
}
