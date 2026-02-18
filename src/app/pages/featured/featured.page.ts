import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Globals } from '../../globals';

@Component({
  standalone: true,
  selector: 'app-featured',
  templateUrl: './featured.page.html',
  styleUrls: ['./featured.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class FeaturedPage {
  constructor(public globals: Globals) {}
}
