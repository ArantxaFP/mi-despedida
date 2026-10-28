import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Autenticacion } from '../../servicios/autenticacion';

@Component({
  selector: 'app-recuperar-contrasena',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './recuperar-contrasena.html',
  styleUrl: './recuperar-contrasena.scss'
})
export class RecuperarContrasena {
  private constructorFormulario = inject(FormBuilder);
  private autenticacion = inject(Autenticacion);

  enviado = signal(false);
  enviando = signal(false);
  mensajeRecuperacion = signal('');
  errorRecuperacion = signal(false);

  formulario = this.constructorFormulario.nonNullable.group({
    correo: [
      '',
      [
        Validators.required,
        Validators.email,
        Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
      ]
    ]
  });

  async recuperarContrasena(): Promise<void> {
    if (this.enviando() || this.enviado()) {
      return;
    }

    this.mensajeRecuperacion.set('');
    this.errorRecuperacion.set(false);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.enviando.set(true);

    try {
      const correo = this.formulario.controls.correo.value.trim();

      const { error } = await this.autenticacion.recuperarContrasena(correo);

      if (error) {
        console.error('Error al solicitar la recuperación:', error.message);
        this.errorRecuperacion.set(true);
        this.mensajeRecuperacion.set(
          'No se ha podido procesar la solicitud. Inténtalo de nuevo más tarde.'
        );
        return;
      }

      this.enviado.set(true);
      this.mensajeRecuperacion.set(
        'Si existe una cuenta asociada a este correo, recibirás un mensaje con las instrucciones para cambiar tu contraseña. Revisa también la carpeta de spam.'
      );

    } catch {
      this.errorRecuperacion.set(true);
      this.mensajeRecuperacion.set(
        'No se ha podido conectar con el servicio. Inténtalo de nuevo más tarde.'
      );
    } finally {
      this.enviando.set(false);
    }
  }
}