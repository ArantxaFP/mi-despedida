import { Component, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion, type BloqueoEdicionCuenta } from '../../../servicios/autenticacion';
import { Router } from '@angular/router';
import { configuracionBackend } from '../../../configuracion/backend';

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

    // Redirigir al acceso cuando se haya confirmado la baja de la cuenta
    private router = inject(Router);

    vistaActual = signal<VistaPerfil>('datos');
    cargando = signal(true);
    guardando = signal(false);

    // Indica si el administrador está editando sus datos personales
    editandoDatos = signal(false);

    readonly solicitandoBloqueo = signal(false);

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
        if (this.solicitandoBloqueo() || this.guardando()) {
            return;
        }

        if (vista !== 'datos' && this.editandoDatos()) {
            this.cancelarEdicionDatos();
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
                        : error?.message ?? 'No se han podido guardar tus datos.'
                );
                return;
            }

            // NestJS ya ha liberado el bloqueo al completar el guardado
            this.detenerRenovacionBloqueo();
            this.bloqueoPerfil = null;

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

            this.mensaje.set(resultado.mensaje);

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

    // Solicitar la baja voluntaria de la cuenta
    async confirmarBaja(): Promise<void> {

        // Evitar peticiones duplicadas y exigir la confirmación expresa
        if (
            this.cargando() ||
            this.guardando() ||
            this.vistaActual() !== 'baja'
        ) {
            return;
        }

        if (this.formularioBaja.invalid) {
            this.formularioBaja.markAllAsTouched();
            return;
        }

        this.guardando.set(true);
        this.mensaje.set('');
        this.error.set('');

        // Distinguir un error de la petición de un error posterior al cerrar sesión
        let bajaConfirmada = false;

        try {
            const token = await this.autenticacion.obtenerTokenAcceso();

            if (!token) {
                this.error.set(
                    'Tu sesión ha caducado. Vuelve a iniciar sesión.'
                );
                return;
            }

            // Nest identifica al administrador desde su sesión.
            // No se envía ningún identificador de cuenta desde el navegador.
            const respuesta = await fetch(
                `${configuracionBackend.url}/cuentas/perfil/baja`,
                {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    cache: 'no-store'
                }
            );

            if (!respuesta.ok) {

                // Mostrar el motivo si hay una activación en curso
                const datosError: { message?: unknown } | null =
                    await respuesta.json().catch(() => null);

                this.error.set(
                    respuesta.status === 409 &&
                        typeof datosError?.message === 'string'
                        ? datosError.message
                        : 'No se ha podido tramitar la baja de tu cuenta.'
                );

                return;
            }

            const resultado: { estado: string } =
                await respuesta.json();

            // No cerrar la sesión hasta que Nest confirme la baja
            if (resultado.estado !== 'baja') {
                this.error.set(
                    'El servidor no ha confirmado la baja.'
                );
                return;
            }

            bajaConfirmada = true;

            // La cuenta ya está dada de baja.
            // Cerrar la sesión local de Supabase.
            const cierreSesion =
                await this.autenticacion.cerrarSesion();

            if (cierreSesion.error) {
                this.error.set(
                    'La baja se ha realizado, pero no se ha podido cerrar ' +
                    'la sesión automáticamente.'
                );
            }

            // Salir del panel sin permitir volver mediante el historial
            await this.router.navigate(['/acceso'], {
                queryParams: {
                    estadoCuenta: 'baja'
                },
                replaceUrl: true
            });

        } catch {

            if (bajaConfirmada) {

                // La baja ya se aplicó: no indicar que ha fallado el borrado
                this.error.set(
                    'La baja se ha realizado, pero ha ocurrido un problema ' +
                    'al cerrar la sesión. Sal del panel e inicia una nueva sesión.'
                );

            } else {

                this.error.set(
                    'No se ha podido conectar con el servicio. ' +
                    'No se ha confirmado la baja.'
                );
            }

        } finally {

            // Permitir volver a intentarlo si la baja no se ha confirmado
            this.guardando.set(false);
        }
    }
}
