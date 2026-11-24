import { Component, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { configuracionBackend } from '../../configuracion/backend';
import { enlaces } from '../../configuracion/enlaces';
import { EspacioLanzador } from '../espacio-lanzador/espacio-lanzador';

// Estados de la pantalla pública de acceso como lanzador
type PantallaAcceso =
  | 'correo'
  | 'respuesta'
  | 'seleccion'
  | 'enlace-enviado'
  | 'canjear'
  | 'sesion';

// Administradores para los que el lanzador está autorizado
interface AdministradorAutorizado {
  asignacionId: string;
  administradorId: string;
  administradorNombre: string;
}

// Respuesta después de verificar el código de 8 dígitos
interface RespuestaVerificacion {
  tokenSeleccion: string;
  administradores: AdministradorAutorizado[];
}

// Respuesta al canjear un enlace
interface RespuestaCanje {
  tokenSesion: string;
  caducaEn: string;
  administradorId: string;
  administrador: string;
}

// Datos de una sesión temporal
interface RespuestaSesion {
  administradorId: string;
  administradorNombre: string;
  caducaEn: string;
}

@Component({
  selector: 'app-acceso-lanzador',
  imports: [ReactiveFormsModule, RouterLink, EspacioLanzador],
  templateUrl: './acceso-lanzador.html',
  styleUrl: './acceso-lanzador.scss'
})
export class AccesoLanzador implements OnInit {

  private readonly ruta = inject(ActivatedRoute);
  private readonly ubicacion = inject(Location);

  private readonly rutaApi =
    `${configuracionBackend.url}/contactos-lanzadores`;

  private readonly claveSesion =
    'mi-despedida:sesion-lanzador';

  readonly urlWebComercial = enlaces.webComercial;

  // Estado actual de la pantalla
  readonly pantalla = signal<PantallaAcceso>('correo');
  readonly mostrarCodigo = signal(false);

  // Estado de las peticiones
  readonly cargando = signal(false);
  readonly errorAcceso = signal('');

  // Autorizaciones disponibles tras verificar el correo
  readonly administradores = signal<AdministradorAutorizado[]>([]);

  // Credenciales y sesión temporal
  readonly tokenSeleccion = signal<string | null>(null);
  readonly tokenEnlace = signal<string | null>(null);
  readonly tokenSesion = signal<string | null>(null);
  readonly sesion = signal<RespuestaSesion | null>(null);

  formularioCorreo;
  formularioCodigo;

  constructor(private constructorFormulario: FormBuilder) {
    this.formularioCorreo = this.constructorFormulario.nonNullable.group({
      correo: [
        '',
        [
          Validators.required,
          Validators.email,
          Validators.pattern(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/)
        ]
      ]
    });

    this.formularioCodigo = this.constructorFormulario.nonNullable.group({
      codigo: [
        '',
        [
          Validators.required,
          Validators.pattern(/^\d{8}$/)
        ]
      ]
    });
  }

  // Solicitar un acceso sin mostrar si existen autorizaciones por privacidad de datos
  async solicitarAcceso(): Promise<void> {

    if (this.cargando()) return;

    if (this.formularioCorreo.invalid) {
      this.formularioCorreo.markAllAsTouched();
      return;
    }

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {
      const correo = this.formularioCorreo.controls.correo.value
        .trim()
        .toLowerCase();

      await this.peticion(
        'acceso/solicitar',
        'POST',
        { correo }
      );

      // La respuesta es idéntica para cualquier correo
      this.pantalla.set('respuesta');
      this.mostrarCodigo.set(false);

    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }

  // Mostrar o ocultar el formulario del código
  cambiarFormularioCodigo(): void {

    if (this.cargando()) return;

    this.errorAcceso.set('');
    this.mostrarCodigo.update(valor => !valor);
  }

  // Realizar peticiones al backend Nest
  private async peticion<T = unknown>(
    ruta: string,
    metodo: 'GET' | 'POST',
    cuerpo?: Record<string, unknown>,
    sesionToken?: string
  ): Promise<T> {

    const cabeceras: Record<string, string> = {
      Accept: 'application/json'
    };

    if (cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
    }

    if (sesionToken) {
      cabeceras['x-lanzador-session'] = sesionToken;
    }

    let respuesta: Response;

    try {
      respuesta = await fetch(`${this.rutaApi}/${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo !== undefined
          ? JSON.stringify(cuerpo)
          : undefined,
        cache: 'no-store',
        referrerPolicy: 'no-referrer'
      });

    } catch {
      throw new Error('No se ha podido conectar con el servidor.');
    }

    if (!respuesta.ok) {

      if (respuesta.status === 429) {
        throw new Error(
          'Has excedido el límite de intentos. Vuelve a intentarlo más tarde.'
        );
      }

      if (respuesta.status === 401 || respuesta.status === 403) {
        throw new Error(
          'El acceso no es válido, ha caducado o ya no está autorizado.'
        );
      }

      throw new Error(
        'No se ha podido completar la operación. Inténtalo de nuevo.'
      );
    }

    return (await respuesta.json()) as T;
  }

  // Mostrar los errores del proceso de acceso
  private mostrarError(error: unknown): void {

    this.errorAcceso.set(
      error instanceof Error
        ? error.message
        : 'Ha habido un error. Inténtalo de nuevo.'
    );
  }

  // Verificar el correo cuando el lanzador tiene varias autorizaciones
  async verificarCodigo(): Promise<void> {

    if (this.cargando()) return;

    if (this.formularioCodigo.invalid) {
      this.formularioCodigo.markAllAsTouched();
      return;
    }

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {
      const datos = await this.peticion<RespuestaVerificacion>(
        'acceso/verificar-codigo',
        'POST',
        {
          correo: this.formularioCorreo.controls.correo.value
            .trim()
            .toLowerCase(),
          codigo: this.formularioCodigo.controls.codigo.value.trim()
        }
      );

      if (
        !datos ||
        typeof datos.tokenSeleccion !== 'string' ||
        !/^[a-f0-9]{64}$/.test(datos.tokenSeleccion) ||
        !Array.isArray(datos.administradores) ||
        datos.administradores.length === 0
      ) {
        throw new Error(
          'El servidor no ha devuelto una selección válida.'
        );
      }

      this.tokenSeleccion.set(datos.tokenSeleccion);
      this.administradores.set(datos.administradores);

      this.formularioCodigo.reset();
      this.pantalla.set('seleccion');

    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }

  // Solicitar el enlace específico del administrador seleccionado
  async seleccionarAdministrador(
    administrador: AdministradorAutorizado
  ): Promise<void> {

    if (this.cargando()) return;

    const token = this.tokenSeleccion();
    if (!token) return;

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {
      await this.peticion(
        'acceso/seleccionar-administrador',
        'POST',
        {
          tokenSeleccion: token,
          asignacionId: administrador.asignacionId
        }
      );

      this.tokenSeleccion.set(null);
      this.administradores.set([]);

      this.pantalla.set('enlace-enviado');

    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }


  // Detectar el enlace recibido sin consumirlo automáticamente
  ngOnInit(): void {

    const token = this.ruta.snapshot.queryParamMap.get('token');

    if (token !== null) {

      // Retirar el token de la barra de direcciones
      this.ubicacion.replaceState('/acceso-lanzador');

      if (/^[a-f0-9]{64}$/.test(token)) {

        this.tokenEnlace.set(token);
        this.pantalla.set('canjear');

      } else {

        this.errorAcceso.set(
          'El enlace recibido no tiene un formato válido.'
        );
      }

      return;
    }

    void this.recuperarSesion();
  }


  // Canjear el enlace de un solo uso por una sesión temporal
  async canjearEnlace(): Promise<void> {

    if (this.cargando()) return;

    const token = this.tokenEnlace();
    if (!token) return;

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {
      const datos = await this.peticion<RespuestaCanje>(
        'acceso/canjear-enlace',
        'POST',
        { token }
      );

      if (
        !datos ||
        typeof datos.tokenSesion !== 'string' ||
        !/^[a-f0-9]{64}$/.test(datos.tokenSesion)
      ) {
        throw new Error(
          'El servidor no ha devuelto una sesión válida.'
        );
      }

      this.tokenEnlace.set(null);
      this.tokenSesion.set(datos.tokenSesion);

      this.sesion.set({
        administradorId: datos.administradorId,
        administradorNombre: datos.administrador,
        caducaEn: datos.caducaEn
      });

      this.guardarTokenSesion(datos.tokenSesion);
      this.pantalla.set('sesion');

    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }


  // Recuperar una sesión temporal al recargar la página
  private async recuperarSesion(): Promise<void> {

    const token = this.leerTokenSesion();

    if (!token) return;

    if (!/^[a-f0-9]{64}$/.test(token)) {
      this.eliminarTokenSesion();
      return;
    }

    this.cargando.set(true);

    try {
      const datos = await this.peticion<RespuestaSesion>(
        'acceso/sesion',
        'GET',
        undefined,
        token
      );

      this.tokenSesion.set(token);
      this.sesion.set(datos);
      this.pantalla.set('sesion');

    } catch {

      this.tokenSesion.set(null);
      this.sesion.set(null);
      this.eliminarTokenSesion();

      this.errorAcceso.set(
        'La sesión anterior no está disponible. Solicita un nuevo acceso.'
      );

    } finally {
      this.cargando.set(false);
    }
  }

  // Cerrar la sesión de lanzador
  async cerrarSesion(): Promise<void> {

    if (this.cargando()) return;

    const token = this.tokenSesion();
    if (!token) return;

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {
      await this.peticion(
        'acceso/cerrar-sesion',
        'POST',
        undefined,
        token
      );

      this.tokenSesion.set(null);
      this.sesion.set(null);
      this.eliminarTokenSesion();

      this.formularioCorreo.reset();
      this.pantalla.set('correo');

    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }

  // Volver al formulario inicial
  volverAlCorreo(): void {

    if (this.cargando()) return;

    this.errorAcceso.set('');
    this.administradores.set([]);
    this.tokenSeleccion.set(null);

    this.formularioCodigo.reset();
    this.mostrarCodigo.set(false);

    this.pantalla.set('correo');
  }

  // Mantener la sesión en la pestaña actual.
  // Es provisional hasta completar la gestión de sesiones del frontend.
  private guardarTokenSesion(token: string): void {

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(this.claveSesion, token);
      }
    } catch {
      // Si el navegador lo bloquea, la sesión sigue en memoria
    }
  }

  private leerTokenSesion(): string | null {

    try {
      return typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage.getItem(this.claveSesion);
    } catch {
      return null;
    }
  }

  private eliminarTokenSesion(): void {

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(this.claveSesion);
      }
    } catch {
      // El cierre se ha solicitado al backend
    }
  }

}
