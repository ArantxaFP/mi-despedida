import { IsString, Matches } from 'class-validator';

export class SuspenderCuentaDto {
    @IsString()
    @Matches(/\S/, {
        message: 'Indica el motivo de la suspensión.'
    })
    motivo: string;
}