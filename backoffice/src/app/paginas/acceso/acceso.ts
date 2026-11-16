import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../servicios/autenticacion';
import { enlaces } from '../../configuracion/enlaces';
import { configuracionBackend } from '../../configuracion/backend';

interface DatosAcceso {
  rol: string;
  estado: string;
}

@Component({
  selector: 'app-acceso',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './acceso.html',
  styleUrl: './acceso.scss'
})
export class Acceso {

  private autenticacion = inject(Autenticacion);
  private constructorFormulario = inject(FormBuilder);
  private router = inject(Router);

  readonly urlWebComercial = enlaces.webComercial;

  contrasenaVisible = false;

  accediendo = signal(false);
  mensajeAcceso = signal('');

  formulario = this.constructorFormulario.nonNullable.group({
    correo: ['', [
      Validators.required,
      Validators.email,
      Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
    ]],
    contrasena: ['', [Validators.required]]
  });

  cambiarVisibilidadContrasena(): void {
    this.contrasenaVisible = !this.contrasenaVisible;
  }

  // Consulta el rol y el estado de la cuenta autenticada.
  // Si todavía no existe el registro en PostgreSQL, se devuelve null
  private async consultarAccesoActual(): Promise<DatosAcceso | null> {
    const token = await this.autenticacion.obtenerTokenAcceso();

    if (!token) {
      throw new Error('No existe una sesión válida.');
    }

    const respuesta = await fetch(
      `${configuracionBackend.url}/cuentas/mi-acceso`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: 'no-store'
      }
    );

    // El servicio devuelve 403 cuando no existe el registro operativo
    if (respuesta.status === 403) {
      return null;
    }

    if (!respuesta.ok) {
      throw new Error('No se ha podido consultar el acceso.');
    }

    const datos: DatosAcceso = await respuesta.json();

    if (
      typeof datos.rol !== 'string' ||
      typeof datos.estado !== 'string'
    ) {
      throw new Error('La respuesta de acceso no es válida.');
    }

    return datos;
  }

  async iniciarSesion(): Promise<void> {
    this.mensajeAcceso.set('');

    if (this.accediendo()) {
      return;
    }

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.accediendo.set(true);

    try {
      const datos = this.formulario.getRawValue();

      const { error } = await this.autenticacion.iniciarSesion(
        datos.correo.trim(),
        datos.contrasena
      );

      if (error) {
        this.mensajeAcceso.set(
          'No se ha podido iniciar sesión. Comprueba tus datos y que hayas confirmado tu correo electrónico. Si acabas de registrarte, verifica primero tu cuenta y revisa la carpeta de spam.'
        );
        return;
      }

      // Comprobar que NestJS reconoce la cuenta y que su estado permite acceder al backoffice.
      // Comprobar el rol y el estado para acceder al panel correspondiente.
      let destinoPanel: string;

      try {
        const accesoInicial = await this.consultarAccesoActual();

        if (accesoInicial?.rol === 'superadministrador') {

          // Los superadministradores tienen un procedimiento propio de activación mediante invitación.
          // No ejecutar sincronizarCuenta() para estas cuentas.
          if (accesoInicial.estado !== 'activa') {
            await this.autenticacion.cerrarSesion();

            this.mensajeAcceso.set(
              'Tu cuenta todavía no está habilitada para acceder al panel.'
            );
            return;
          }

          destinoPanel = '/superadmin';

        } else {

          // El registro público solo permite cuentas de administrador
          if (
            accesoInicial &&
            accesoInicial.rol !== 'administrador'
          ) {
            await this.autenticacion.cerrarSesion();

            this.mensajeAcceso.set(
              'Tu cuenta no dispone de acceso a este panel.'
            );
            return;
          }

          // Sincronización y recuperación de registros
          const estadoCuenta =
            await this.autenticacion.sincronizarCuenta();

          if (estadoCuenta !== 'activa') {
            await this.autenticacion.cerrarSesion();

            this.mensajeAcceso.set(
              'Tu cuenta no está habilitada para acceder al panel.'
            );
            return;
          }

          // Comprobar nuevamente el rol después de la sincronización
          const accesoFinal = await this.consultarAccesoActual();

          if (
            !accesoFinal ||
            accesoFinal.rol !== 'administrador' ||
            accesoFinal.estado !== 'activa'
          ) {
            await this.autenticacion.cerrarSesion();

            this.mensajeAcceso.set(
              'No se ha podido confirmar el acceso a tu panel.'
            );
            return;
          }

          destinoPanel = '/panel/dashboard';
        }

      } catch {
        await this.autenticacion.cerrarSesion();

        this.mensajeAcceso.set(
          'No se ha podido verificar el estado de tu cuenta. Inténtalo de nuevo más tarde.'
        );
        return;
      }

      // Inicio de sesión correcto y cuenta activa:
      // acceder al panel correspondiente según el rol.
      const navegacionCorrecta =
        await this.router.navigateByUrl(
          destinoPanel,
          { replaceUrl: true }
        );


      if (!navegacionCorrecta) {
        this.mensajeAcceso.set(
          'Has iniciado sesión, pero no se ha podido abrir el panel.'
        );
      }

    } catch {
      this.mensajeAcceso.set(
        'No se ha podido conectar con el servicio. Vuelve a intentarlo dentro de un rato.'
      );

    } finally {
      this.accediendo.set(false);
    }
  }
}
