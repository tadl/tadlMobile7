import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Globals } from '../../globals';

@Component({
  standalone: true,
  selector: 'app-about',
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class AboutPage {
  constructor(public globals: Globals) {}
}
