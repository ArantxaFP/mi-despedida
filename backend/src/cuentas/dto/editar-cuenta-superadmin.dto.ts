import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Datos que puede modificar un superadministrador al editar una cuenta de un administrador
export class EditarCuentaSuperadminDto {

    @IsString()
    @MinLength(1)
    @MaxLength(100)
    @Matches(/\S/, {
        message: 'El nombre no puede estar vacío.'
    })
    nombre: string;

    @IsOptional()
    @IsString()
    @MaxLength(150)
    apellidos?: string | null;

    // La modificación del correo requerirá verificar la nueva dirección antes de hacer efectivo el cambio.
    // Funcionaría como si el cambio lo hubiese hecho el propio usuario administrador.
    @IsEmail()
    @MaxLength(254)
    correo: string;
}
