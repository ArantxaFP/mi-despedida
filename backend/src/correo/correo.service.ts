import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

@Injectable()
export class CorreoService {

    private readonly logger = new Logger(CorreoService.name);
    private readonly brevo: BrevoClient;
    private readonly remitenteEmail: string;
    private readonly remitenteNombre: string;

    constructor(private readonly config: ConfigService) {

        this.brevo = new BrevoClient({
            apiKey: this.config.getOrThrow<string>('BREVO_API_KEY'),
            maxRetries: 0
        });

        this.remitenteEmail =
            this.config.getOrThrow<string>('BREVO_REMITENTE_EMAIL');

        this.remitenteNombre =
            this.config.get<string>('BREVO_REMITENTE_NOMBRE')
            ?? 'Mi despedida';
    }

    // --------------------------------------------------
    // Escapar caracteres especiales para contenido HTML
    // --------------------------------------------------

    private escaparHtml(valor: string): string {
        return valor
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --------------------------------------------------
    // 1. Enviar una invitación para actuar como lanzador
    // --------------------------------------------------

    async enviarInvitacionLanzador(
        correo: string,
        nombre: string,
        enlace: string
    ): Promise<string> {

        const nombreSeguro = this.escaparHtml(nombre);
        const enlaceSeguro = this.escaparHtml(enlace);

        // Versión HTML del correo con botón de acceso.
        // Los estilos se aplican en línea por compatibilidad con los principales clientes de correo.
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport"
                      content="width=device-width, initial-scale=1.0">
                <title>Invitación como lanzador - Mi despedida</title>
            </head>

            <body style="
                margin: 0;
                padding: 24px 12px;
                background-color: #f5f7fa;
                font-family: Arial, Helvetica, sans-serif;
                color: #273244;
                font-size: 15px;
                line-height: 1.7;
            ">

                <div style="
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 32px 28px;
                    background-color: #ffffff;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                ">

                    <h1 style="
                        margin: 0 0 24px;
                        color: #071d49;
                        font-size: 24px;
                        font-weight: 700;
                    ">
                        Mi despedida
                    </h1>

                    <p>Hola, ${nombreSeguro}.</p>

                    <p>
                        Has recibido una invitación para actuar
                        como lanzador en Mi despedida.
                    </p>

                    <p>
                        Puedes consultar la invitación
                        pulsando el siguiente botón:
                    </p>

                    <table role="presentation"
                           cellspacing="0"
                           cellpadding="0"
                           border="0"
                           align="center"
                           style="margin: 28px auto;">
                        <tr>
                            <td align="center"
                                bgcolor="#071d49"
                                style="border-radius: 6px;">

                                <a href="${enlaceSeguro}"
                                   target="_blank"
                                   style="
                                       display: inline-block;
                                       padding: 14px 26px;
                                       background-color: #071d49;
                                       color: #ffffff;
                                       font-size: 15px;
                                       font-weight: bold;
                                       line-height: 20px;
                                       text-decoration: none;
                                       border-radius: 6px;
                                   ">
                                    Consultar la invitación
                                </a>

                            </td>
                        </tr>
                    </table>

                    <p>
                        Esta invitación tiene una vigencia de
                        <strong>siete días</strong>.
                        Abrir el enlace no implica aceptarla.
                    </p>

                    <p>
                        Para aceptar o rechazar tendrás que verificar
                        que tienes acceso al correo al que se ha
                        enviado esta invitación.
                    </p>

                    <p>
                        No necesitas registrarte ni crear una
                        cuenta de administrador.
                    </p>

                    <p>
                        Si aceptas, podrás solicitar posteriormente
                        un acceso temporal desde la web de Mi despedida.
                        No necesitarás conservar este correo para ello.
                    </p>

                    <hr style="
                        border: 0;
                        border-top: 1px solid #e5e7eb;
                        margin: 28px 0 20px;
                    ">

                    <p style="
                        margin-bottom: 0;
                        color: #667085;
                        font-size: 13px;
                    ">
                        Si no esperabas este mensaje,
                        puedes ignorarlo.
                    </p>

                </div>

            </body>
            </html>
        `;

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Invitación como lanzador',

                    // Versión HTML con botón clicable
                    htmlContent,

                    // Versión alternativa de texto plano
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has recibido una invitación para actuar como ' +
                        'lanzador en Mi despedida.\n\n' +
                        `Puedes consultar la invitación aquí:\n${enlace}\n\n` +
                        'Esta invitación tiene una vigencia de siete días. ' +
                        'Abrir el enlace no implica aceptarla.\n\n' +
                        'Para aceptar o rechazar tendrás que verificar ' +
                        'que tienes acceso al correo al que se ha enviado ' +
                        'esta invitación.\n\n' +
                        'No necesitas registrarte ni crear una cuenta ' +
                        'de administrador.\n\n' +
                        'Si aceptas, podrás solicitar posteriormente ' +
                        'un acceso temporal desde la web de Mi despedida. ' +
                        'No necesitarás conservar este correo para ello.\n\n' +
                        'Si no esperabas este mensaje, puedes ignorarlo.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha devuelto un identificador del mensaje.'
                );
            }

            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío de una invitación a Brevo',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del correo.'
            );
        }
    }

    // --------------------------------------------------
    // 2. Enviar un código de verificación al lanzador
    // --------------------------------------------------

    async enviarCodigoVerificacionLanzador(
        correo: string,
        nombre: string,
        codigo: string
    ): Promise<string> {

        // El código debe tener exactamente ocho dígitos
        if (!/^\d{8}$/.test(codigo)) {
            throw new InternalServerErrorException(
                'No se ha podido preparar el código de verificación.'
            );
        }

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Código de verificación',
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has solicitado verificar tu dirección de correo ' +
                        'para responder a una invitación como lanzador ' +
                        'en Mi despedida.\n\n' +
                        `Tu código de verificación es: ${codigo}\n\n` +
                        'Este código caduca a los 10 minutos.\n\n' +
                        'Introdúcelo en la pantalla donde estás ' +
                        'respondiendo a la invitación.\n\n' +
                        'Verificar tu correo no supone aceptar ' +
                        'automáticamente la invitación. ' +
                        'Después podrás elegir expresamente ' +
                        'si quieres aceptarla o rechazarla.\n\n' +
                        'No compartas este código con nadie.\n\n' +
                        'Si no has solicitado esta verificación, ' +
                        'puedes ignorar el mensaje.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha confirmado la solicitud de envío del código.'
                );
            }

            // Solo devolvemos el identificador del mensaje.
            // No devolvemos ni registramos el código.
            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío del código de verificación',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del código de verificación.'
            );
        }
    }


    // --------------------------------------------------
    // 3. Enviar invitación para crear una cuenta de superadministrador
    // --------------------------------------------------

    async enviarInvitacionSuperadministrador(
        correo: string,
        nombre: string,
        enlace: string
    ): Promise<string> {

        const nombreSeguro = this.escaparHtml(nombre);
        const enlaceSeguro = this.escaparHtml(enlace);

        // El enlace original no se guarda en Postgre ni se devuelve al navegador.
        // Supabase controla su utilización y caducidad.
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Invitación a Mi despedida</title>
            </head>
            <body style="font-family:Arial,sans-serif;line-height:1.6;color:#273244;
                         background-color:#f5f7fa;padding:24px;">
                <div style="max-width:600px;margin:auto;padding:32px;
                            background-color:#ffffff;border-radius:12px;">
                    <h1 style="color:#071d49;">Mi despedida</h1>

                    <p>Hola, ${nombreSeguro}.</p>

                    <p>
                        Has recibido una invitación para incorporarte
                        a Mi despedida como superadministrador.
                    </p>

                    <p>
                        Para verificar tu correo y establecer tu contraseña,
                        utiliza el siguiente enlace:
                    </p>

                    <p>
                        <a href="${enlaceSeguro}"
                           style="display:inline-block;padding:12px 20px;
                                  background-color:#071d49;color:#ffffff;
                                  text-decoration:none;border-radius:6px;">
                            Activar mi cuenta
                        </a>
                    </p>

                    <p>
                        El enlace es de un solo uso y 
                        caduca 1 hora después de su creación.
                    </p>

                    <p>
                        Si no esperabas esta invitación, puedes ignorarla.
                        No compartas este enlace.
                    </p>
                </div>
            </body>
            </html>
        `;

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [{
                        email: correo,
                        name: nombre
                    }],
                    subject: 'Mi despedida - Invitación de superadministrador',
                    htmlContent,
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has sido invitado a Mi despedida como superadministrador.\n' +
                        'Verifica tu correo y establece tu contraseña aquí:\n' +
                        `${enlace}\n\n` +
                        'Este enlace es de un solo uso y ' +
                        'caduca 1 hora después de su creación.\n\n' +
                        'Si no esperabas esta invitación, ignórala.'

                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha confirmado la solicitud de envío.'
                );
            }

            // Solo devolver el identificador del envío
            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al enviar la invitación de superadministrador',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido enviar la invitación.'
            );
        }
    }


    // Correos del acceso posterior como lanzador.
    // No confundir con la verificación de una invitación.
    async enviarCodigoAccesoLanzador(
        correo: string,
        nombre: string,
        codigo: string
    ): Promise<string> {
        if (!/^\d{8}$/.test(codigo)) {
            throw new InternalServerErrorException('Código de acceso no válido.');
        }
        try {
            const resultado = await this.brevo.transactionalEmails.sendTransacEmail({
                sender: { name: this.remitenteNombre, email: this.remitenteEmail },
                to: [{ email: correo, name: nombre }],
                subject: 'Mi despedida - Verificación para acceder como lanzador',
                textContent:
                    `Hola, ${nombre}.\n\n` +
                    'Has solicitado acceder como lanzador a Mi despedida.\n' +
                    `Código de verificación: ${codigo}\n\n` +
                    'Caduca en 10 minutos. Introdúcelo en la pantalla de acceso.\n' +
                    'Una vez verificado, podrás seleccionar el administrador.\n' +
                    'El código no inicia ni confirma ninguna activación.\n\n' +
                    'Si no lo has solicitado, ignora este mensaje.'
            });
            if (!resultado.messageId) throw new Error('Brevo no confirmó el envío.');
            return resultado.messageId;
        } catch (error) {
            this.logger.error('Brevo no confirmó el envío del código de acceso',
                error instanceof Error ? error.message : String(error));
            throw new InternalServerErrorException('No se ha podido enviar el código de acceso.');
        }
    }

    async enviarEnlaceAccesoLanzador(
        correo: string,
        nombre: string,
        nombreAdministrador: string,
        enlace: string
    ): Promise<string> {
        const nombreSeguro = this.escaparHtml(nombre);
        const titularSeguro = this.escaparHtml(nombreAdministrador);
        const enlaceSeguro = this.escaparHtml(enlace);
        const htmlContent = `
            <div style="max-width:600px;margin:auto;padding:28px;font-family:Arial,sans-serif;color:#273244;line-height:1.6">
                <h1 style="color:#071d49">Mi despedida</h1>
                <p>Hola, ${nombreSeguro}.</p>
                <p>Has solicitado acceder como lanzador de <strong>${titularSeguro}</strong>.</p>
                <p>Utiliza este enlace exclusivo y de un solo uso:</p>
                <p style="margin:28px 0">
                    <a href="${enlaceSeguro}" style="background:#071d49;color:white;padding:14px 22px;border-radius:6px;text-decoration:none">
                        Acceder como lanzador
                    </a>
                </p>
                <p>Este enlace caduca a los <strong>7 días</strong>. Al abrirlo podrás iniciar una sesión temporal de hasta una hora para actuar exclusivamente sobre esta cuenta.</p>
                <p>Acceder no inicia ni confirma automáticamente ningún envío. Esas acciones requieren tu confirmación expresa.</p>
                <p>No podrás consultar los contactos ni los mensajes privados de esta persona.</p>
                <p style="color:#667085;font-size:13px">Si no has solicitado este acceso, puedes ignorar el correo.</p>
            </div>`;
        try {
            const resultado = await this.brevo.transactionalEmails.sendTransacEmail({
                sender: { name: this.remitenteNombre, email: this.remitenteEmail },
                to: [{ email: correo, name: nombre }],
                subject: 'Mi despedida - Tu acceso temporal como lanzador',
                htmlContent,
                textContent:
                    `Hola, ${nombre}.\n\n` +
                    `Puedes acceder como lanzador de ${nombreAdministrador}:\n${enlace}\n\n` +
                    'El enlace es de un solo uso y caduca a los 7 días. ' +
                    'La sesión durará como máximo una hora. ' +
                    'Abrir el enlace no activa ningún envío.\n\n' +
                    'Si no has solicitado el acceso, ignora el mensaje.'
            });
            if (!resultado.messageId) throw new Error('Brevo no confirmó el envío.');
            return resultado.messageId;
        } catch (error) {
            this.logger.error('Brevo no confirmó el envío del enlace de acceso',
                error instanceof Error ? error.message : String(error));
            throw new InternalServerErrorException('No se ha podido enviar el enlace de acceso.');
        }
    }

}


