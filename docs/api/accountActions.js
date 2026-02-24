import { create } from 'apisauce';
import * as WebBrowser from 'expo-web-browser';
import _ from 'lodash';
import moment from 'moment';

// custom components and helper files
import { popAlert, popToast } from '../components/loadError';
import { getTermFromDictionary } from '../translations/TranslationService';
import { createAuthTokens, getErrorMessage, getHeaders, postData, stripHTML } from './apiAuth';
import { GLOBALS } from './globals';
import { LIBRARY } from './loadLibrary';
import { logDebugMessage, logErrorMessage } from './logging';

/* ACTIONS ON CHECKOUTS */
export async function renewCheckout(barcode, recordId, source, itemId, libraryUrl, userId) {
     let validId;
     if (itemId == null) {
          validId = barcode;
     } else {
          validId = itemId;
     }

     const postBody = await postData();
     const api = create({
          baseURL: libraryUrl + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          params: {
               itemBarcode: validId,
               recordId,
               itemSource: source,
               userId,
          },
          auth: createAuthTokens(),
     });
     const response = await api.post('/UserAPI?method=renewItem', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (source === 'ils') {
               if (result.confirmRenewalFee) {
                    return result;
               }

               if (result.success === true) {
                    popAlert(result.title, stripHTML(result.message), 'success');
                    //await reloadCheckedOutItems();
               } else {
                    popAlert(result.title, stripHTML(result.message), 'error');
               }
          } else {
               if (result.success === true) {
                    popAlert(result.title, stripHTML(result.message), 'success');
                    //await reloadCheckedOutItems();
               } else {
                    popAlert(result.title, stripHTML(result.message), 'error');
               }
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function confirmRenewCheckout(barcode, recordId, source, itemId, libraryUrl, userId) {
     let validId;
     if (itemId == null) {
          validId = barcode;
     } else {
          validId = itemId;
     }

     const postBody = await postData();
     const api = create({
          baseURL: libraryUrl + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          params: {
               itemBarcode: validId,
               recordId,
               itemSource: source,
               userId,
               confirmedRenewal: true,
          },
          auth: createAuthTokens(),
     });
     const response = await api.post('/UserAPI?method=renewItem', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (source === 'ils') {
               if (result.confirmRenewalFee) {
                    return result;
               }

               if (result.success === true) {
                    popAlert(result.title, result.message, 'success');
                    //await reloadCheckedOutItems();
               } else {
                    popAlert(result.title, result.message, 'error');
               }
          } else {
               if (result.success === true) {
                    popAlert(result.title, result.message, 'success');
                    //await reloadCheckedOutItems();
               } else {
                    popAlert(result.title, result.message, 'error');
               }
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function renewAllCheckouts(url, language = 'en') {
     const postBody = await postData();
     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          auth: createAuthTokens(),
     });
     const response = await api.post('/UserAPI?method=renewAll', postBody);
     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.confirmRenewalFee) {
               return result;
          }

          if (result.success === true) {
               popAlert(result.title, result.renewalMessage[0], 'success');
          } else {
               popAlert(result.title, result.renewalMessage[0], 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function confirmRenewAllCheckouts(url, language = 'en') {
     const postBody = await postData();
     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          params: {
               confirmedRenewal: true,
          },
          auth: createAuthTokens(),
     });
     const response = await api.post('/UserAPI?method=renewAll', postBody);
     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.confirmRenewalFee) {
               return result;
          }

          if (result.success === true) {
               popAlert(result.title, result.renewalMessage[0], 'success');
          } else {
               popAlert(result.title, result.renewalMessage[0], 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function returnCheckout(userId, id, source, overDriveId = null, url, version, axis360Id = null, language = 'en') {
     const postBody = await postData();

     let itemId = id;
     if (overDriveId != null) {
          itemId = overDriveId;
     }
     if (!_.isNull(axis360Id)) {
          itemId = axis360Id;
     }
     if (version >= '22.05.00') {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(true),
               auth: createAuthTokens(),
               params: {
                    itemId,
                    userId,
                    itemSource: source,
               },
          });
          const response = await api.post('/UserAPI?method=returnCheckout', postBody);

          if (response.ok) {
               const fetchedData = response.data;
               const result = fetchedData.result;

               if (result.success === true) {
                    popAlert(result.title, result.message, 'success');
               } else {
                    popAlert(result.title, result.message, 'error');
               }
          } else {
               const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               popToast(error.title, error.message, 'error');
               logErrorMessage(response);
          }
     } else {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(true),
               auth: createAuthTokens(),
               params: {
                    id: itemId,
                    userId,
                    itemSource: source,
               },
          });
          const response = await api.post('/UserAPI?method=returnCheckout', postBody);
          if (response.ok) {
               const fetchedData = response.data;
               const result = fetchedData.result;

               if (result.success === true) {
                    popAlert(result.title, result.message, 'success');
               } else {
                    popAlert(result.title, result.message, 'error');
               }
          } else {
               const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               popToast(error.title, error.message, 'error');
               logErrorMessage(response);
          }
     }
}

export async function viewOnlineItem(userId, id, source, accessOnlineUrl, url, language = 'en') {
     const postBody = await postData();

     if (source === 'hoopla' || source === 'cloud_library') {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(),
               auth: createAuthTokens(),
               params: {
                    userId,
                    itemId: id,
                    itemSource: source,
               },
          });
          const response = await api.post('/UserAPI?method=viewOnlineItem', postBody);

          if (response.ok) {
               const results = response.data;
               const result = results.result.url;

               await WebBrowser.openBrowserAsync(result)
                    .then((res) => {
                         logDebugMessage(res);
                    })
                    .catch(async (err) => {
                         if (err.message === 'Another WebBrowser is already being presented.') {
                              try {
                                   WebBrowser.dismissBrowser();
                                   await WebBrowser.openBrowserAsync(result)
                                        .then((response) => {
                                             logDebugMessage(response);
                                        })
                                        .catch(async (error) => {
                                             popToast(getTermFromDictionary(language, 'error_no_open_resource'), getTermFromDictionary(language, 'error_device_block_browser'), 'error');
                                        });
                              } catch (error) {
                                   logDebugMessage('Really borked.');
                              }
                         } else {
                              popToast(getTermFromDictionary(language, 'error_no_open_resource'), getTermFromDictionary(language, 'error_device_block_browser'), 'error');
                         }
                    });
          } else {
               const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               popToast(error.title, error.message, 'error');
               logErrorMessage(response);
          }
     } else {
          await WebBrowser.openBrowserAsync(accessOnlineUrl)
               .then((res) => {
                    logDebugMessage(res);
               })
               .catch(async (err) => {
                    if (err.message === 'Another WebBrowser is already being presented.') {
                         try {
                              WebBrowser.dismissBrowser();
                              await WebBrowser.openBrowserAsync(accessOnlineUrl)
                                   .then((response) => {
                                        logDebugMessage(response);
                                   })
                                   .catch((error) => {
                                        logErrorMessage(error);
                                        popToast(getTermFromDictionary(language, 'error_no_open_resource'), getTermFromDictionary(language, 'error_device_block_browser'), 'error');
                                   });
                         } catch (error) {
                              logErrorMessage(error);
                              logErrorMessage('Unable to open.');
                         }
                    } else {
                         popToast(getTermFromDictionary(language, 'error_no_open_resource'), getTermFromDictionary(language, 'error_device_block_browser'), 'error');
                    }
               });
     }
}

export async function viewOverDriveItem(userId, formatId, overDriveId, url, language = 'en') {
     const postBody = await postData();

     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutFast,
          headers: getHeaders(),
          auth: createAuthTokens(),
          params: {
               userId,
               overDriveId,
               formatId: formatId ?? '',
               itemSource: 'overdrive',
          },
     });
     const response = await api.post('/UserAPI?method=viewOnlineItem', postBody);

     if (response.ok) {
          const result = response.data;
          const accessUrl = result.result.url;

          await WebBrowser.openBrowserAsync(accessUrl)
               .then((res) => {
                    logDebugMessage(res);
               })
               .catch(async (err) => {
                    if (err.message === 'Another WebBrowser is already being presented.') {
                         try {
                              WebBrowser.dismissBrowser();
                              await WebBrowser.openBrowserAsync(accessUrl)
                                   .then((response) => {
                                        logDebugMessage(response);
                                   })
                                   .catch(async (error) => {
                                        logErrorMessage('Unable to close previous browser session.');
                                        logErrorMessage(error);
                                   });
                         } catch (error) {
                              logErrorMessage('Really borked.');
                              logErrorMessage(error);
                         }
                    } else {
                         popToast(getTermFromDictionary(language, 'error_no_open_resource'), getTermFromDictionary(language, 'error_device_block_browser'), 'error');
                    }
               });
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

/* ACTIONS ON HOLDS */
export async function freezeHold(cancelId, recordId, source, url, patronId, selectedReactivationDate = null, language = 'en') {
     const postBody = await postData();

     const today = moment().format('YYYY-MM-DD');
     let reactivationDate = null;
     if (selectedReactivationDate) {
          reactivationDate = moment(selectedReactivationDate).format('YYYY-MM-DD');
          if (reactivationDate === 'Invalid date') {
               reactivationDate = null;
          } else if (reactivationDate === today) {
               reactivationDate = moment().add(30, 'days').format('YYYY-MM-DD');
          }
     } else {
          reactivationDate = moment().add(30, 'days').format('YYYY-MM-DD');
     }

     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutSlow,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: {
               sessionId: GLOBALS.appSessionId,
               holdId: cancelId,
               recordId,
               itemSource: source,
               reactivationDate,
               userId: patronId,
          },
     });
     const response = await api.post('/UserAPI?method=freezeHold', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.success === true) {
               popAlert(result.title ?? getTermFromDictionary(language, 'hold_frozen'), result.message, 'success');
          } else {
               popAlert(result.title ?? getTermFromDictionary(language, 'unable_freeze_hold'), result.message, 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function freezeHolds(data, url, selectedReactivationDate = null, language = 'en') {
     const postBody = await postData();

     const today = moment().format('YYYY-MM-DD');
     let reactivationDate = null;
     if (selectedReactivationDate) {
          reactivationDate = moment(selectedReactivationDate).format('YYYY-MM-DD');
          if (reactivationDate === 'Invalid date') {
               reactivationDate = null;
          } else if (reactivationDate === today) {
               reactivationDate = moment().add(30, 'days').format('YYYY-MM-DD');
          }
     } else {
          reactivationDate = moment().add(30, 'days').format('YYYY-MM-DD');
     }

     let numSuccess = 0;
     let numFailed = 0;

     const holdsToFreeze = data.map(async (hold, index) => {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(true),
               auth: createAuthTokens(),
               params: {
                    sessionId: GLOBALS.appSessionId,
                    holdId: hold.cancelId,
                    recordId: hold.recordId,
                    itemSource: hold.source,
                    reactivationDate,
                    userId: hold.patronId,
               },
          });
          const response = await api.post('/UserAPI?method=freezeHold', postBody);
          if (response.ok) {
               const fetchedData = response.data;
               const result = fetchedData.result;

               if (result.success == true) {
                    numSuccess = numSuccess + 1;
               } else {
                    numFailed = numFailed + 1;
               }
          } else {
               getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               logErrorMessage(response);
               numFailed = numFailed + 1;
          }
     });

     //Wait for all actions to finish
     await Promise.all(holdsToFreeze);

     let message = '';
     let status = 'success';
     let title = getTermFromDictionary(language, 'holds_frozen');
     if (numSuccess > 0) {
          message = message.concat(numSuccess + ' holds frozen successfully.');
     }

     if (numFailed > 0) {
          status = 'error';
          message = message.concat(' Unable to freeze ' + numFailed + ' holds.');
          if (numSuccess === 0) {
               title = getTermFromDictionary(language, 'unable_freeze_hold');
          }
     }

     popAlert(title, message, status);
}

export async function thawHold(cancelId, recordId, source, url, patronId, language = 'en') {
     const postBody = await postData();

     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: {
               sessionId: GLOBALS.appSessionId,
               holdId: cancelId,
               recordId,
               itemSource: source,
               userId: patronId,
          },
     });
     const response = await api.post('/UserAPI?method=activateHold', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.success === true) {
               popAlert(result.title ?? getTermFromDictionary(language, 'hold_thawed'), result.message, 'success');
          } else {
               popAlert(result.title ?? getTermFromDictionary(language, 'unable_thaw_hold'), result.message, 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function thawHolds(data, url, language = 'en') {
     const postBody = await postData();

     let numSuccess = 0;
     let numFailed = 0;

     data.map(async (hold, index) => {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(true),
               auth: createAuthTokens(),
               params: {
                    sessionId: GLOBALS.appSessionId,
                    holdId: hold.cancelId,
                    recordId: hold.recordId,
                    itemSource: hold.source,
                    userId: hold.patronId,
               },
          });
          const response = await api.post('/UserAPI?method=activateHold', postBody);
          if (response.ok) {
               const fetchedData = response.data;
               const result = fetchedData.result;

               if (result.success === true) {
                    numSuccess = numSuccess + 1;
               } else {
                    numFailed = numFailed + 1;
               }
          } else {
               getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               logErrorMessage(response);
               numFailed = numFailed + 1;
          }
     });

     let message = '';
     let status = 'success';
     if (numSuccess > 0) {
          message = message.concat(numSuccess + ' holds thawed successfully.');
     }

     if (numFailed > 0) {
          status = 'warning';
          message = message.concat(' Unable to thaw ' + numFailed + ' holds.');
     }
     popAlert(getTermFromDictionary(language, 'holds_thawed'), message, status);
}

export async function cancelHold(cancelId, recordId, source, url, patronId, language = 'en') {
     const postBody = await postData();
     const api = create({
          baseURL: url + '/API',
          timeout: GLOBALS.timeoutFast,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: {
               sessionId: GLOBALS.appSessionId,
               cancelId,
               recordId,
               itemSource: source,
               userId: patronId,
          },
     });
     const response = await api.post('/UserAPI?method=cancelHold', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.success === true) {
               popAlert(result.title, result.message, 'success');
          } else {
               popAlert(result.title, result.message, 'error');
          }

     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function cancelHolds(data, url, language = 'en') {
     const postBody = await postData();

     let numSuccess = 0;
     let numFailed = 0;

     const holdsToCancel = data.map(async (hold, index) => {
          const api = create({
               baseURL: url + '/API',
               timeout: GLOBALS.timeoutFast,
               headers: getHeaders(true),
               auth: createAuthTokens(),
               params: {
                    sessionId: GLOBALS.appSessionId,
                    cancelId: hold.cancelId,
                    recordId: hold.recordId,
                    itemSource: hold.source,
                    userId: hold.patronId,
               },
          });
          const response = await api.post('/UserAPI?method=cancelHold', postBody);
          if (response.ok) {
               const fetchedData = response.data;
               const result = fetchedData.result;

               if (result.success === true) {
                    numSuccess = numSuccess + 1;
               } else {
                    console.log(response);
                    numFailed = numFailed + 1;
               }
          } else {
               getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
               logErrorMessage(response);
               numFailed = numFailed + 1;
          }
     });

     let message = '';
     let status = 'success';
     if (numSuccess > 0) {
          message = message.concat(numSuccess + ' holds cancelled successfully.');
     }

     if (numFailed > 0) {
          status = 'warning';
          message = message.concat(' Unable to cancel ' + numFailed + ' holds.');
     }
     popAlert(getTermFromDictionary(language, 'holds_cancelled'), message, status);
}

export async function changeHoldPickUpLocation(holdId, newLocation, newSublocation, url = null, userId, language = 'en') {
     let baseUrl = url ?? LIBRARY.url;
     const postBody = await postData();
     const params = {
          sessionId: GLOBALS.appSessionId,
          holdId,
          newLocation,
          newSublocation,
          userId,
     };
     const api = create({
          baseURL: baseUrl + '/API',
          timeout: GLOBALS.timeoutFast,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: params,
     });
     const response = await api.post('/UserAPI?method=changeHoldPickUpLocation', postBody);

     if (response.ok) {
          const fetchedData = response.data;
          const result = fetchedData.result;

          if (result.success === true) {
               popAlert(result.title, result.message, 'success');
          } else {
               popAlert(result.title, result.message, 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function updateOverDriveEmail(itemId, source, patronId, overdriveEmail, promptForOverdriveEmail, libraryUrl, language = 'en') {
     const postBody = await postData();
     const api = create({
          baseURL: libraryUrl + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: {
               itemId,
               itemSource: source,
               userId: patronId,
               overdriveEmail,
               promptForOverdriveEmail,
          },
     });
     const response = await api.post('/UserAPI?method=updateOverDriveEmail', postBody);

     if (response.ok) {
          const responseData = response.data;
          return responseData.result;
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}

export async function cancelVdxRequest(libraryUrl, sourceId, cancelId, language = 'en') {
     const postBody = await postData();
     const api = create({
          baseURL: libraryUrl + '/API',
          timeout: GLOBALS.timeoutAverage,
          headers: getHeaders(true),
          auth: createAuthTokens(),
          params: {
               sourceId,
               cancelId,
          },
     });
     const response = await api.post('/UserAPI?method=cancelVdxRequest', postBody);
     if (response.ok) {
          if (response.data.result.success === 'true') {
               popAlert(response.data.result.title, response.data.result.message, 'success');
          } else {
               logDebugMessage(response);
               popAlert(getTermFromDictionary(language, 'error'), response.data.result.message, 'error');
          }
     } else {
          const error = getErrorMessage({ statusCode: response.status, problem: response.problem, sendToSentry: true });
          popToast(error.title, error.message, 'error');
          logErrorMessage(response);
     }
}
