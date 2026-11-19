import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { Autenticacion, type BloqueoEdicionCuenta } from '../../../servicios/autenticacion';
import { configuracionBackend } from '../../../configuracion/backend';

interface CuentaSuperadmin {
  id: string;
  nombre: string;
  apellidos: string | null;
  correo: string;
  rol: string;
  estado: string;
}

interface BorradorCuenta {
  nombre: string;
  apellidos: string;
  correo: string;
}

interface PrevisualizacionEdicion {
  cuentaId: string;

  camposModificados: {
    nombre: boolean;
    apellidos: boolean;
    correo: boolean;
  };

  requiereVerificacionCorreo: boolean;
  guardado: boolean;
}

@Component({
  selector: 'app-cuentas-superadmin',
  standalone: true,
  templateUrl: './cuentas-superadmin.html',
  styleUrl: './cuentas-superadmin.scss'
})

export class CuentasSuperadmin implements OnInit, OnDestroy {

  private readonly autenticacion = inject(Autenticacion);

  readonly cuentas = signal<CuentaSuperadmin[]>([]);

  readonly cargando = signal(false);
  readonly mensajeError = signal('');

  readonly filtro = signal('');

  readonly cuentaEnEdicionId = signal<string | null>(null);

  readonly solicitandoBloqueo = signal(false);

  private readonly usarBloqueoSuperadministrador = true;
  private bloqueoEdicion: BloqueoEdicionCuenta | null = null;
  private componenteDestruido = false;

  readonly borradorCuenta = signal<BorradorCuenta | null>(null);

  readonly previsualizacion = signal<PrevisualizacionEdicion | null>(null);
  readonly previsualizando = signal(false);
  readonly errorPrevisualizacion = signal('');

  readonly hayCambios = computed(() => {
    const id = this.cuentaEnEdicionId();

    const borrador = this.borradorCuenta();
    const original = this.cuentas().find(cuenta => cuenta.id === id);

    if (!original || !borrador) {
      return false;
    }

    return (
      borrador.nombre.trim() !== original.nombre ||
      borrador.apellidos.trim() !== (original.apellidos ?? '') ||
      borrador.correo.trim().toLowerCase() !== original.correo
    );
  });

  readonly cuentasFiltradas = computed(() => {
    const texto = this.filtro().trim().toLowerCase();

    if (!texto) {
      return this.cuentas();
    }

    return this.cuentas().filter(cuenta =>
      cuenta.id === this.cuentaEnEdicionId() ||
      [
        cuenta.nombre,
        cuenta.apellidos ?? '',
        cuenta.correo,
        cuenta.rol,
        cuenta.estado
      ].some(valor => valor.toLowerCase().includes(texto))
    );
  });

  // Iniciar la edición de una única fila
  async iniciarEdicion(cuenta: CuentaSuperadmin): Promise<void> {
    if (
      this.cargando() ||
      this.solicitandoBloqueo() ||
      this.cuentaEnEdicionId() !== null
    ) {
      return;
    }

    if (!this.usarBloqueoSuperadministrador) {
      this.abrirEdicion(cuenta);
      return;
    }

    this.mensajeError.set('');
    this.solicitandoBloqueo.set(true);

    try {
      const { datos: bloqueo, error, conflicto } =
        await this.autenticacion.adquirirBloqueoSuperadministrador(cuenta.id);

      if (this.componenteDestruido) {
        if (bloqueo) {
          void this.autenticacion.liberarBloqueoSuperadministrador(
            cuenta.id,
            bloqueo.token
          );
        }
        return;
      }

      if (error || !bloqueo) {
        this.mensajeError.set(
          conflicto
            ? 'Esta cuenta ya está siendo editada. Inténtalo más tarde.'
            : error?.message ?? 'No se ha podido iniciar la edición.'
        );
        return;
      }

      const cuentaActualizada = {
        ...cuenta,
        ...bloqueo.datosActuales
      };

      this.bloqueoEdicion = bloqueo;
      this.cuentas.update(cuentas =>
        cuentas.map(actual =>
          actual.id === cuenta.id ? cuentaActualizada : actual
        )
      );
      this.abrirEdicion(cuentaActualizada);
    } finally {
      this.solicitandoBloqueo.set(false);
    }
  }

  private abrirEdicion(cuenta: CuentaSuperadmin): void {
    this.cuentaEnEdicionId.set(cuenta.id);
    this.borradorCuenta.set({
      nombre: cuenta.nombre,
      apellidos: cuenta.apellidos ?? '',
      correo: cuenta.correo
    });
    this.previsualizacion.set(null);
    this.errorPrevisualizacion.set('');
  }

  // Actualizar únicamente el borrador local
  actualizarCampo(
    campo: keyof BorradorCuenta,
    valor: string
  ): void {

    this.borradorCuenta.update(actual =>
      actual
        ? { ...actual, [campo]: valor }
        : null
    );

    this.previsualizacion.set(null);
    this.errorPrevisualizacion.set('');
  }

  // Cancelar la edición sin modificar los datos originales
  cancelarEdicion(): void {
    this.liberarBloqueoEdicion();
    this.cuentaEnEdicionId.set(null);
    this.borradorCuenta.set(null);
    this.previsualizacion.set(null);
    this.errorPrevisualizacion.set('');
  }

  private liberarBloqueoEdicion(): void {
    const cuentaId = this.cuentaEnEdicionId();
    const bloqueo = this.bloqueoEdicion;
    this.bloqueoEdicion = null;

    if (cuentaId && bloqueo) {
      void this.autenticacion.liberarBloqueoSuperadministrador(
        cuentaId,
        bloqueo.token
      );
    }
  }

  ngOnDestroy(): void {
    this.componenteDestruido = true;
    this.liberarBloqueoEdicion();
  }

  // Consultar los cambios propuestos antes de guardar. No modifica.
  async previsualizarCambios(): Promise<void> {

    const cuentaId = this.cuentaEnEdicionId();
    const borrador = this.borradorCuenta();

    if (
      !cuentaId ||
      !borrador ||
      !this.hayCambios() ||
      this.previsualizando()
    ) {
      return;
    }

    this.previsualizando.set(true);
    this.errorPrevisualizacion.set('');
    this.previsualizacion.set(null);

    // Conservar los valores exactos enviados para la previsualización
    const datosEnviados = { ...borrador };

    try {
      const token =
        await this.autenticacion.obtenerTokenAcceso();

      if (!token) {
        throw new Error('No existe una sesión válida.');
      }

      const respuesta = await fetch(
        `${configuracionBackend.url}/cuentas/superadmin/cuentas/${cuentaId}/previsualizar-edicion`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(datosEnviados),

          cache: 'no-store'
        }
      );

      if (!respuesta.ok) {
        throw new Error('No se han podido validar los cambios.');
      }

      const resultado: PrevisualizacionEdicion =
        await respuesta.json();

      // Evitar mostrar una respuesta de una edición ya cancelada
      // Mostrar el resultado solo si seguimos editando la misma cuenta y los campos no han cambiado.

      const borradorActual = this.borradorCuenta();

      if (
        this.cuentaEnEdicionId() === cuentaId &&
        borradorActual?.nombre === datosEnviados.nombre &&
        borradorActual?.apellidos === datosEnviados.apellidos &&
        borradorActual?.correo === datosEnviados.correo
      ) {
        this.previsualizacion.set(resultado);
      }

    } catch {

      if (this.cuentaEnEdicionId() === cuentaId) {
        this.errorPrevisualizacion.set(
          'No se han podido previsualizar los cambios.'
        );
      }

    } finally {
      this.previsualizando.set(false);
    }
  }


  ngOnInit(): void {
    void this.actualizarCuentas();
  }

  // Consultar las cuentas a través de Nest.
  // Solo superadministradores activos tienen permiso.
  async actualizarCuentas(): Promise<void> {

    if (
      this.cargando() ||
      this.solicitandoBloqueo() ||
      this.cuentaEnEdicionId() !== null
    ) {
      return;
    }

    this.cargando.set(true);
    this.mensajeError.set('');

    try {
      const token =
        await this.autenticacion.obtenerTokenAcceso();

      if (!token) {
        throw new Error('No existe una sesión válida.');
      }

      const respuesta = await fetch(
        `${configuracionBackend.url}/cuentas/superadmin/listado`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: 'no-store'
        }
      );

      if (!respuesta.ok) {
        throw new Error('No se ha podido consultar el listado.');
      }

      const datos: CuentaSuperadmin[] = await respuesta.json();

      if (!Array.isArray(datos)) {
        throw new Error('La respuesta del servidor no es válida.');
      }

      this.cuentas.set(datos);

    } catch {
      this.mensajeError.set(
        'No se han podido cargar las cuentas. Inténtalo de nuevo dentro de un rato.'
      );

    } finally {
      this.cargando.set(false);
    }
  }



}
