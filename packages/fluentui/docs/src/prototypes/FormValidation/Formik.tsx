import * as React from 'react';
import { Form } from '@fluentui/react-northstar';
import { Formik } from 'formik';

const FormValidateFormik = () => (
  <Formik
    initialValues={{
      firstName: '',
      city: '',
    }}
    validate={values => {
      const errors: {
        firstName?: string;
        city?: string;
      } = {};
      if (!values.firstName) {
        errors.firstName = 'Required';
      }
      if (values.firstName && values.firstName.length < 4) {
        errors.firstName = 'Too small';
      }
      if (!values.city.length) {
        errors.city = 'Required';
      }
      return errors;
    }}
    onSubmit={(values, { setSubmitting }) => {
      console.log(JSON.stringify(values, null, 2));
      setSubmitting(false);
    }}
    render={({ handleSubmit, handleChange, errors, handleBlur, setTouched, touched, values, setFieldValue }) => (
      <Form onSubmit={handleSubmit}>
        <Form.Input
          errorMessage={touched.firstName && errors.firstName}
          onBlur={handleBlur}
          onChange={handleChange}
          showSuccessIndicator={Boolean(values.firstName.length >= 4)}
          label="First Name"
          name="firstName"
          id="first-name-inline"
        />
        <Form.Dropdown
          onBlur={e => {
            setTouched({ ...touched, city: true });
          }}
          onChange={(e, props) => {
            setFieldValue('city', props.value);
          }}
          label="City"
          id="city"
          errorMessage={touched.city && errors.city}
          items={['prague', 'new york']}
        />
        <Form.Button content="Submit" />
      </Form>
    )}
  />
);

export default FormValidateFormik;
