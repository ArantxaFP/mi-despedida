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

    async enviarInvitacionLanzador(
        correo: string,
        nombre: string,
        enlace: string
    ): Promise<string> {

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
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has recibido una invitación para actuar como ' +
                        'lanzador en Mi despedida.\n\n' +
                        `Puedes consultar la invitación aquí:\n${enlace}\n\n` +
                        'Esta invitación tiene una vigencia de siete días. ' +
                        'Abrir el enlace no implica aceptarla.\n\n' +
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
                'Error al solicitar el envío a Brevo',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del correo.'
            );
        }
    }
}
