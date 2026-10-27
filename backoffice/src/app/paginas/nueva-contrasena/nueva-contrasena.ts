
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Autenticacion } from '../../servicios/autenticacion';

@Component({
  selector: 'app-nueva-contrasena',
  imports: [ReactiveFormsModule],
  templateUrl: './nueva-contrasena.html',
  styleUrl: './nueva-contrasena.scss'
})
export class NuevaContrasena {
  private constructorFormulario = inject(FormBuilder);
  private autenticacion = inject(Autenticacion);

  mostrarContrasena = false;
  mostrarConfirmacion = false;

  guardando = signal(false);
  mensaje = signal('');
  contrasenaCambiada = signal(false);

  formulario = this.constructorFormulario.nonNullable.group({
    contrasena: ['', [Validators.required, Validators.minLength(8)]],
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

    if (this.guardando() || this.contrasenaCambiada()) {
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
      const { error } = await this.autenticacion.cambiarContrasena(
        datos.contrasena
      );

      if (error) {
        this.mensaje.set(
          'No se ha podido cambiar la contraseña. Comprueba que has accedido desde tu cuenta o desde un enlace de recuperación válido.'
        );
        return;
      }

      this.contrasenaCambiada.set(true);
      this.formulario.reset();
      this.mensaje.set('La contraseña se ha cambiado correctamente.');
    } catch {
      this.mensaje.set(
        'No se ha podido conectar con el servicio. Vuelve a intentarlo.'
      );
    } finally {
      this.guardando.set(false);
    }
  }
}
