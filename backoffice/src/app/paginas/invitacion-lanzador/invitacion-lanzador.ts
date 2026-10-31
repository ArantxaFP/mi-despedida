import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { InvitacionesLanzadoresApi } from '../../servicios/invitaciones-lanzadores-api';

@Component({
    selector: 'app-invitacion-lanzador',
    standalone: true,
    imports: [],
    templateUrl: './invitacion-lanzador.html',
    styleUrl: './invitacion-lanzador.scss'
})
export class InvitacionLanzador implements OnInit {

    private readonly route = inject(ActivatedRoute);
    private readonly invitacionesApi =
        inject(InvitacionesLanzadoresApi);

    readonly cargando = signal(true);
    readonly procesando = signal(false);
    readonly valida = signal(false);
    readonly resuelta = signal(false);

    readonly mensaje = signal('');
    readonly fechaCaducidad = signal('');

    // Estados de verificación del correo del lanzador
    readonly codigoSolicitado = signal(false);
    readonly codigoVerificacion = signal('');
    readonly correoVerificado = signal(false);

    private token = '';

    // Credencial temporal que emitirá NestJS tras comprobar el código de verificación
    private credencialVerificacion = '';

    // --------------------------------------------------
    // 1. Consulta el enlace al entrar en la pantalla
    // --------------------------------------------------

    async ngOnInit(): Promise<void> {

        this.token =
            this.route.snapshot.queryParamMap.get('token') ?? '';

        if (!/^[a-f0-9]{64}$/.test(this.token)) {
            this.mensaje.set(
                'El enlace de invitación no es válido.'
            );
            this.cargando.set(false);
            return;
        }

        try {
            const resultado =
                await this.invitacionesApi.consultar(this.token);

            this.valida.set(resultado.valida);

            if (resultado.valida) {
                this.fechaCaducidad.set(
                    resultado.fechaCaducidad ?? ''
                );
            } else {
                this.mensaje.set(
                    'Esta invitación ha caducado, ' +
                    'ya se ha utilizado o no está disponible.'
                );
            }

        } catch {
            this.mensaje.set(
                'No se ha podido consultar la invitación. ' +
                'Comprueba tu conexión e inténtalo de nuevo.'
            );

        } finally {
            this.cargando.set(false);
        }
    }

    // --------------------------------------------------
    // 2. Solicitar el código de verificación por correo
    // --------------------------------------------------

    async solicitarCodigo(): Promise<void> {

        if (
            this.procesando() ||
            !this.valida() ||
            this.resuelta()
        ) {
            return;
        }

        this.procesando.set(true);
        this.mensaje.set('');

        try {
            await this.invitacionesApi.solicitarCodigo(
                this.token
            );

            this.codigoSolicitado.set(true);
            this.codigoVerificacion.set('');
            this.correoVerificado.set(false);
            this.credencialVerificacion = '';

            this.mensaje.set(
                'Si la invitación sigue vigente, ' +
                'recibirás un código en el correo electrónico ' +
                'al que fue enviada.'
            );

        } catch {
            this.mensaje.set(
                'No se ha podido procesar la solicitud. ' +
                'Inténtalo de nuevo más tarde.'
            );

        } finally {
            this.procesando.set(false);
        }
    }

    // --------------------------------------------------
    // 3. Actualizar el código introducido por el usuario
    // --------------------------------------------------

    actualizarCodigo(evento: Event): void {

        const elemento =
            evento.target as HTMLInputElement;

        const codigo = elemento.value
            .replace(/\D/g, '')
            .slice(0, 8);

        this.codigoVerificacion.set(codigo);

        if (elemento.value !== codigo) {
            elemento.value = codigo;
        }
    }

    // --------------------------------------------------
    // 4. Verificar el código con el backend NestJS
    // --------------------------------------------------

    async verificarCodigo(): Promise<void> {

        if (
            this.procesando() ||
            !this.valida() ||
            !this.codigoSolicitado() ||
            !/^\d{8}$/.test(this.codigoVerificacion())
        ) {
            return;
        }

        this.procesando.set(true);
        this.mensaje.set('');

        try {
            const resultado =
                await this.invitacionesApi.verificarCodigo(
                    this.token,
                    this.codigoVerificacion()
                );

            // Angular no decide si el correo está verificado.
            // Únicamente refleja la confirmación de NestJS.
            this.credencialVerificacion =
                resultado.credencialVerificacion;

            this.correoVerificado.set(true);
            this.codigoVerificacion.set('');

            this.mensaje.set(
                'Correo electrónico verificado correctamente.'
            );

        } catch (error) {
            this.correoVerificado.set(false);
            this.credencialVerificacion = '';

            this.mensaje.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido verificar el código.'
            );

        } finally {
            this.procesando.set(false);
        }
    }

    // --------------------------------------------------
    // 5. Aceptar o rechazar expresamente la invitación
    // --------------------------------------------------

    async responder(
        decision: 'aceptar' | 'rechazar'
    ): Promise<void> {

        if (
            this.procesando() ||
            !this.valida() ||
            this.resuelta() ||
            !this.correoVerificado() ||
            !this.credencialVerificacion
        ) {
            return;
        }

        this.procesando.set(true);
        this.mensaje.set('');

        try {
            const resultado =
                await this.invitacionesApi.responder(
                    this.token,
                    decision,
                    this.credencialVerificacion
                );

            this.resuelta.set(true);
            this.valida.set(false);
            this.correoVerificado.set(false);

            // Eliminar la credencial de la memoria del componente después de resolver la invitación.
            this.credencialVerificacion = '';
            this.codigoVerificacion.set('');

            this.mensaje.set(resultado.mensaje);

        } catch (error) {
            this.mensaje.set(
                error instanceof Error
                    ? error.message
                    : 'No se ha podido responder a la invitación.'
            );

        } finally {
            this.procesando.set(false);
        }
    }
}
