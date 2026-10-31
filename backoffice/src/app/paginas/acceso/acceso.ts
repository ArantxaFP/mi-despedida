import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../servicios/autenticacion';

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
      let estadoCuenta: string;

      try {
        estadoCuenta =
          await this.autenticacion.sincronizarCuenta();
      } catch {
        await this.autenticacion.cerrarSesion();

        this.mensajeAcceso.set(
          'No se ha podido verificar el estado de tu cuenta. Inténtalo de nuevo más tarde.'
        );
        return;
      }

      if (estadoCuenta !== 'activa') {
        await this.autenticacion.cerrarSesion();

        this.mensajeAcceso.set(
          'Tu cuenta no está habilitada para acceder al panel.'
        );
        return;
      }

      // Inicio de sesión correcto y cuenta activa:
      // acceder al panel privado.
      const navegacionCorrecta =
        await this.router.navigateByUrl(
          '/panel/dashboard',
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
