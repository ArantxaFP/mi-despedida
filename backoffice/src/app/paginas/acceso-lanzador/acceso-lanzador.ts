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

// Respuesta al iniciar una sesión temporal de lanzador
interface RespuestaInicioSesion {
  tokenSesion: string;
  caducaEn: string;
  administradorId: string;
  administradorNombre: string;
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

  // Estado de las peticiones
  readonly cargando = signal(false);
  readonly errorAcceso = signal('');

  // Autorizaciones disponibles tras verificar el correo
  readonly administradores = signal<AdministradorAutorizado[]>([]);


  // Credenciales y sesión temporal
  readonly tokenSeleccion = signal<string | null>(null);
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

      // La respuesta es idéntica para cualquier correo.
      // Mostrar directamente el formulario de verificación del código.
      this.formularioCodigo.reset();
      this.pantalla.set('respuesta');




    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
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


  // Verificar el correo mediante el código de ocho dígitos.
  // Se utiliza independientemente del número de autorizaciones vigentes.
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

      // Si solo existe un administrador autorizado, iniciar la sesión directamente sin mostrar la selección
      if (datos.administradores.length === 1) {

        await this.iniciarSesionAdministrador(
          datos.administradores[0]
        );

      } else {

        // Si hay varios administradores autorizados, el lanzador deberá seleccionar para cuál quiere actuar
        this.pantalla.set('seleccion');

      }







    } catch (error) {
      this.mostrarError(error);

    } finally {
      this.cargando.set(false);
    }
  }


  // Seleccionar el administrador para el que actuará el lanzador.
  // Se utiliza cuando existen varias autorizaciones vigentes.
  async seleccionarAdministrador(
    administrador: AdministradorAutorizado
  ): Promise<void> {

    if (this.cargando()) return;

    this.cargando.set(true);
    this.errorAcceso.set('');

    try {

      await this.iniciarSesionAdministrador(administrador);

    } catch (error) {

      this.mostrarError(error);

    } finally {

      this.cargando.set(false);

    }
  }


  // Iniciar una sesión temporal con el administrador autorizado.
  // Si solo existe una autorización, se ejecuta automáticamente.
  // Si hay varias, se ejecuta después de la selección del lanzador.
  // No se solicitan ni se envían enlaces adicionales por correo.
  private async iniciarSesionAdministrador(
    administrador: AdministradorAutorizado
  ): Promise<void> {

    const token = this.tokenSeleccion();

    if (!token) {
      throw new Error(
        'La verificación ya no está disponible. Solicita un nuevo código.'
      );
    }

    const datos = await this.peticion<RespuestaInicioSesion>(
      'acceso/seleccionar-administrador',
      'POST',
      {
        tokenSeleccion: token,
        asignacionId: administrador.asignacionId
      }
    );

    // Comprobar que el servidor ha devuelto una sesión válida y vinculada al administrador seleccionado
    if (
      !datos ||
      typeof datos.tokenSesion !== 'string' ||
      !/^[a-f0-9]{64}$/.test(datos.tokenSesion) ||
      datos.administradorId !== administrador.administradorId ||
      typeof datos.administradorNombre !== 'string' ||
      typeof datos.caducaEn !== 'string' ||
      !Number.isFinite(Date.parse(datos.caducaEn)) ||
      Date.parse(datos.caducaEn) <= Date.now()
    ) {
      throw new Error(
        'El servidor no ha devuelto una sesión válida.'
      );
    }

    // La credencial temporal de selección ya se ha utilizado
    this.tokenSeleccion.set(null);
    this.administradores.set([]);

    // Guardar el token de la nueva sesión
    this.tokenSesion.set(datos.tokenSesion);

    // Datos autorizados que se mostrarán en el espacio del lanzador
    this.sesion.set({
      administradorId: datos.administradorId,
      administradorNombre: datos.administradorNombre,
      caducaEn: datos.caducaEn
    });

    // Mantener la sesión en la pestaña actual
    this.guardarTokenSesion(datos.tokenSesion);

    // Acceder directamente al espacio del contacto lanzador
    this.pantalla.set('sesion');
  }



  // Recuperar una sesión temporal al entrar en la pantalla.
  // OJO: los antiguos enlaces de acceso ya no están habilitados.
  ngOnInit(): void {

    const token = this.ruta.snapshot.queryParamMap.get('token');

    if (token !== null) {

      // Retirar el token antiguo de la barra de direcciones.
      this.ubicacion.replaceState('/acceso-lanzador');

      this.errorAcceso.set(
        'El acceso mediante enlace ya no está disponible. ' +
        'Solicita un código de verificación.'
      );

      return;
    }

    void this.recuperarSesion();
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

    this.formularioCorreo.reset();
    this.formularioCodigo.reset();

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
