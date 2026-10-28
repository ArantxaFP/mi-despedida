import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../servicios/autenticacion';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-nueva-contrasena',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './nueva-contrasena.html',
  styleUrl: './nueva-contrasena.scss'
})
export class NuevaContrasena {
  private constructorFormulario = inject(FormBuilder);
  private autenticacion = inject(Autenticacion);

  recuperacionAutorizada = this.autenticacion.recuperacionAutorizada;
  comprobandoRecuperacion = this.autenticacion.comprobandoRecuperacion;

  mostrarContrasena = false;
  mostrarConfirmacion = false;

  guardando = signal(false);
  mensaje = signal('');
  contrasenaCambiada = signal(false);

  formulario = this.constructorFormulario.nonNullable.group({
    contrasena: ['', [
      Validators.required,
      Validators.minLength(10),
      Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s]).+$/)
    ]],
    confirmarContrasena: ['', [Validators.required]]
  });

  cambiarVisibilidadContrasena(): void {
    this.mostrarContrasena = !this.mostrarContrasena;
  }

  cambiarVisibilidadConfirmacion(): void {
    this.mostrarConfirmacion = !this.mostrarConfirmacion;
  }

  async guardarContrasena(): Promise<void> {
    this.mensaje.set('');

    if (
      !this.recuperacionAutorizada() ||
      this.guardando() ||
      this.contrasenaCambiada()
    ) {
      return;
    }

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const datos = this.formulario.getRawValue();

    if (datos.contrasena !== datos.confirmarContrasena) {
      this.mensaje.set('Las contraseñas no coinciden.');
      return;
    }

    this.guardando.set(true);

    try {
      const { data, error } = await this.autenticacion.obtenerUsuario();

      if (error || !data.user) {
        this.mensaje.set(
          'La sesión de recuperación no es válida. Solicita un nuevo enlace.'
        );
        return;
      }

      const resultado = await this.autenticacion.cambiarContrasena(
        datos.contrasena
      );

      if (resultado.error) {
        this.mensaje.set(
          'No se ha podido establecer la nueva contraseña. Inténtalo de nuevo.'
        );
        return;
      }


      this.contrasenaCambiada.set(true);
      this.recuperacionAutorizada.set(false);
      this.formulario.reset();

      this.mensaje.set(
        'La contraseña se ha actualizado correctamente. Ya puedes volver al inicio de sesión.'
      );

    } catch {
      this.mensaje.set(
        'No se ha podido conectar con el servicio. Vuelve a intentarlo.'
      );
    } finally {
      this.guardando.set(false);
    }
  }
}
