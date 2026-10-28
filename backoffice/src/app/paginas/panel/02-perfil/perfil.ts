import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../../servicios/autenticacion';

type VistaPerfil = 'datos' | 'correo' | 'contrasena' | 'baja';

@Component({
    selector: 'app-perfil',
    imports: [ReactiveFormsModule],
    templateUrl: './perfil.html',
    styleUrl: './perfil.scss'
})
export class Perfil implements OnInit {
    private autenticacion = inject(Autenticacion);
    private constructorFormulario = inject(FormBuilder);

    vistaActual = signal<VistaPerfil>('datos');
    cargando = signal(true);
    guardando = signal(false);
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

            this.formularioDatos.patchValue({
                nombre: usuario.user_metadata?.['nombre'] ?? '',
                apellidos: usuario.user_metadata?.['apellidos'] ?? ''
            });

            this.correoActual.set(usuario.email ?? '');
            this.correoVerificado.set(
                Boolean(usuario.email_confirmed_at)
            );

        } catch {
            this.error.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.cargando.set(false);
        }
    }

    cambiarVista(vista: VistaPerfil): void {
        this.vistaActual.set(vista);
        this.mensaje.set('');
        this.error.set('');

        this.formularioCorreo.reset();
        this.formularioContrasena.reset();
        this.formularioBaja.reset();

        this.mostrarContrasena.set(false);
        this.mostrarConfirmacion.set(false);
    }

    async guardarDatos(): Promise<void> {
        this.mensaje.set('');
        this.error.set('');

        if (this.guardando()) return;

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
            const { error } =
                await this.autenticacion.actualizarDatosPersonales(
                    nombre,
                    apellidos
                );

            if (error) {
                this.error.set(
                    'No se han podido guardar tus datos. Inténtalo de nuevo.'
                );
                return;
            }

            this.formularioDatos.patchValue({
                nombre,
                apellidos
            });

            this.mensaje.set(
                'Tus datos personales se han actualizado correctamente.'
            );

        } catch {
            this.error.set(
                'No se ha podido conectar con el servicio.'
            );
        } finally {
            this.guardando.set(false);
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
