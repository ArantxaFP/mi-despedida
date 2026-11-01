import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { enlaces } from '../../configuracion/enlaces';

@Component({
    selector: 'app-header',
    imports: [
        RouterLink,
        RouterLinkActive
    ],
    templateUrl: './header.html',
    styleUrl: './header.scss'
})
export class Header {

    menuOpen = false;

    readonly urlAcceso = enlaces.acceso;

    toggleMenu(): void {
        this.menuOpen = !this.menuOpen;
    }

    closeMenu(): void {
        this.menuOpen = false;
    }
}
