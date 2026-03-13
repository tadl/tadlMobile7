import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { PasswordResetService } from '../../services/password-reset.service';

@Component({
  standalone: true,
  selector: 'app-password-reset-modal',
  templateUrl: './password-reset-modal.component.html',
  styleUrls: ['./password-reset-modal.component.scss'],
  imports: [CommonModule, IonicModule, FormsModule],
})
export class PasswordResetModalComponent {
  username = '';
  email = '';
  submitting = false;
  submitted = false;
  submitTitle = '';
  submitMessage = '';

  constructor(
    public globals: Globals,
    private modalCtrl: ModalController,
    private passwordReset: PasswordResetService,
  ) {}

  async close() {
    await this.modalCtrl.dismiss();
    this.globals.modal_open = false;
  }

  submit() {
    const username = (this.username ?? '').toString().trim();
    const email = (this.email ?? '').toString().trim();

    if (!username || !email) {
      this.submitTitle = 'Missing Information';
      this.submitMessage = 'Please enter your username/card number and email to continue.';
      return;
    }

    this.submitting = true;
    this.passwordReset.submitResetRequest({ username, email })
      .pipe(finalize(() => { this.submitting = false; }))
      .subscribe({
        next: () => {
          this.submitted = true;
          this.submitTitle = 'Request Sent';
          this.submitMessage =
            'Your request was received. If the email address on file matches the one provided, you should receive a reset link within a few minutes.';
        },
        error: (err) => {
          const msg = (err?.message ?? '').toString();
          if (msg === 'password_reset_network_or_cors') {
            this.submitted = true;
            this.submitTitle = 'Request Received';
            this.submitMessage =
              'Your request was received. If the email address on file matches the one provided, you should receive a reset link within a few minutes.';
            return;
          }
          this.submitted = true;
          this.submitTitle = 'Could Not Confirm Submission';
          this.submitMessage =
            'We could not confirm submission in-app. Please use "Reset on Website" to complete password reset.';
        },
      });
  }

}
